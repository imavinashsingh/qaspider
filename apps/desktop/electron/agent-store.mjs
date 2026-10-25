import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { snapshotDatabase } from './conversations.mjs';
import { safeAgentText } from './agent-context.mjs';

export const agentScope = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid() }).strict();
export const agentSend = agentScope.extend({ requestId: z.string().uuid(), text: z.string().trim().min(1).max(6000) }).strict();

/** Chat bookkeeping only. Existing messages remain authoritative; graph checkpoints store their turn IDs. */
export class AgentStore {
  constructor(store) {
    this.store = store; this.db = store.db;
    const migrated = this.db.prepare('SELECT 1 FROM desktop_additive_migrations WHERE name=?').get('vnext-main-agent-1');
    if (!migrated && store.path !== ':memory:') this.backupPath = snapshotDatabase(this.db, store.path, 'main-agent');
    store.atomic(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS desktop_agent_threads(
          conversation_id TEXT PRIMARY KEY REFERENCES desktop_conversations(id), project_id TEXT NOT NULL REFERENCES desktop_projects(id),
          agent_id TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_agent_turns(
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES desktop_agent_threads(conversation_id), request_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','UNAVAILABLE','ERROR','INTERRUPTED')),
          user_message_id TEXT NOT NULL REFERENCES desktop_messages(id), assistant_message_id TEXT REFERENCES desktop_messages(id),
          sources_json TEXT NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
          UNIQUE(conversation_id,request_id));
        CREATE INDEX IF NOT EXISTS desktop_agent_turn_conversation ON desktop_agent_turns(conversation_id,created_at);
      `);
      this.db.prepare('INSERT OR IGNORE INTO desktop_additive_migrations VALUES(?,?)').run('vnext-main-agent-1', new Date().toISOString());
      for (const row of this.db.prepare("SELECT id FROM desktop_agent_turns WHERE status='RUNNING'").all()) {
        this.finish(row.id, 'INTERRUPTED', 'This reply was interrupted by a desktop restart. Send a new message to continue; no model call or browser action was automatically repeated.', [], {});
      }
    });
  }
  scope(input) {
    const scope = agentScope.parse(input), conversation = this.store.conversations.get(scope.conversationId);
    if (conversation.projectId !== scope.projectId) throw new Error('Conversation does not belong to this project.');
    return { ...scope, profile: this.store.conversations.profiles.get(scope.projectId) };
  }
  start(input) {
    const scope = this.scope(input), now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO desktop_agent_threads VALUES(?,?,?,?,?)')
      .run(scope.conversationId, scope.projectId, scope.profile.agentId, `${scope.profile.agentId}:${scope.conversationId}`, now);
    return this.history(input);
  }
  history(input) {
    const scope = this.scope(input);
    const thread = this.db.prepare('SELECT thread_id AS threadId,agent_id AS agentId FROM desktop_agent_threads WHERE conversation_id=? AND project_id=?').get(scope.conversationId, scope.projectId);
    const turns = this.db.prepare(`SELECT t.id,t.status,t.created_at AS createdAt,t.completed_at AS completedAt,u.body AS userText,a.body AS reply,
      t.sources_json,t.metrics_json FROM desktop_agent_turns t JOIN desktop_messages u ON u.id=t.user_message_id
      LEFT JOIN desktop_messages a ON a.id=t.assistant_message_id WHERE t.conversation_id=? ORDER BY t.rowid DESC LIMIT 50`).all(scope.conversationId).reverse();
    return { ...input, threadId: thread?.threadId ?? null, agentId: scope.profile.agentId,
      turns: turns.map(({ sources_json, metrics_json, ...turn }) => ({ ...turn, sources: JSON.parse(sources_json), metrics: JSON.parse(metrics_json) })) };
  }
  existing(conversationId, requestId) { return this.db.prepare('SELECT id FROM desktop_agent_turns WHERE conversation_id=? AND request_id=?').get(conversationId, requestId); }
  begin(input) {
    const request = agentSend.parse(input), scope = { projectId: request.projectId, conversationId: request.conversationId };
    const { profile } = this.scope(scope);
    if (profile.archived) throw new Error('Restore the project before sending a new message.');
    const clean = safeAgentText(request.text, 6000);
    if (clean.includes('[redacted')) throw new Error('Leave credentials, access tokens and secrets out of chat. Use test-data references instead.');
    this.start(scope);
    const id = randomUUID(), messageId = randomUUID(), now = new Date().toISOString();
    this.store.atomic(() => {
      this.db.prepare('INSERT INTO desktop_messages VALUES(?,?,?,?,?,?,?)').run(messageId, request.conversationId, 'user', clean, null, null, now);
      this.db.prepare('INSERT INTO desktop_agent_turns VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, request.conversationId, request.requestId, 'RUNNING', messageId, null, '[]', '{}', now, null);
    });
    return id;
  }
  turn(id) {
    const row = this.db.prepare(`SELECT t.*,u.body AS text,th.project_id AS projectId,th.thread_id AS threadId FROM desktop_agent_turns t
      JOIN desktop_messages u ON u.id=t.user_message_id JOIN desktop_agent_threads th ON th.conversation_id=t.conversation_id WHERE t.id=?`).get(id);
    if (!row) throw new Error('Chat turn not found.');
    return { ...row, conversationId: row.conversation_id };
  }
  finish(id, status, reply, sources, metrics) {
    const row = this.turn(id);
    if (row.status !== 'RUNNING') return;
    const messageId = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO desktop_messages VALUES(?,?,?,?,?,?,?)').run(messageId, row.conversationId, 'assistant', safeAgentText(reply, 6000), null, null, now);
    this.db.prepare('UPDATE desktop_agent_turns SET status=?,assistant_message_id=?,sources_json=?,metrics_json=?,completed_at=? WHERE id=? AND status=?')
      .run(status, messageId, JSON.stringify(sources), JSON.stringify(metrics), now, id, 'RUNNING');
  }
  complete(...args) { return this.store.atomic(() => this.finish(...args)); }
  recent(scope, currentId) {
    // Agent chat only: do not copy arbitrary old planning payloads or full project history.
    const turns = this.history(scope).turns.filter(turn => turn.id !== currentId && turn.status === 'COMPLETED').slice(-6);
    let remaining = 10000;
    return turns.reverse().map(turn => {
      const text = safeAgentText(`User: ${turn.userText}\nAgent: ${turn.reply}`, Math.min(2000, remaining)); remaining -= text.length;
      return text;
    }).filter(Boolean).reverse();
  }
}
