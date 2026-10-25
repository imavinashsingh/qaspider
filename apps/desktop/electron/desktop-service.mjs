import { z } from 'zod';
import { ExecutableDraft } from './executable-draft.mjs';

const request = z.object({ conversationId: z.string().uuid(), text: z.string().trim().min(1).max(12000) }).strict();

/** Thin application coordination. No browser commands execute here. */
export class DesktopService {
  constructor(store, { planner, provider, options = {}, draft, onProgress } = {}) {
    this.store = store; this.planner = planner;
    this.draft = draft ?? new ExecutableDraft({ provider, options, onProgress });
  }
  async send(input) {
    const { conversationId, text } = request.parse(input);
    this.store.conversations.get(conversationId);
    const criteria = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (criteria.length > 20 || criteria.some(line => line.length > 2000)) throw new Error('Use up to 20 acceptance criteria, one per line, each at most 2000 characters.');
    this.store.conversations.message(conversationId, 'user', text);
    const proposed = await this.planner.propose({ title: criteria[0].slice(0, 200), description: text, acceptanceCriteria: criteria });
    if (proposed.status !== 'proposed') {
      this.store.conversations.message(conversationId, 'assistant', proposed.message);
      return this.store.conversations.get(conversationId);
    }
    const saved = this.store.create(proposed.plan, { executionRequired: true });
    this.store.conversations.linkPlan(conversationId, saved.planId, 'I prepared a test proposal. Discover and prepare executable bindings, then review the original expectations and approve the exact revision. No browser actions are authorized.');
    return this.store.conversations.get(conversationId);
  }
  async prepare(input) {
    const { planId, revision, version } = z.object({ planId: z.string().uuid(), revision: z.number().int().positive(), version: z.number().int().positive() }).strict().parse(input);
    const snapshot = this.store.get(planId), conversation = this.store.conversations.forPlan(planId);
    if (!conversation || snapshot.revision !== revision || snapshot.version !== version || !snapshot.content.executionRequired) throw new Error('Reload the current conversation plan.');
    const binding = await this.draft.prepare(snapshot, conversation);
    const current = this.store.conversations.get(conversation.id);
    if (current.version !== conversation.version) throw new Error('Context changed during discovery.');
    return this.store.bindExecution(planId, version, binding, revision);
  }
}
