import { DatabaseSync } from 'node:sqlite';
import { KnowledgeStore } from './knowledge.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { assertNoSymlinks, privateDirectory } from '../../../packages/storage/src/filesystem.ts';
import { ticketPlanSchema, validateTicketPlan } from '../shared/ticket-plan.mjs';
import { initialReview, validateReviewContent, plannedCoverage, approvalIssues } from '../shared/plan-review.mjs';
import { ConversationStore, backupBeforeConsolidation, backupBeforeProjectFoundation } from './conversations.mjs';
import { normalizePlan, genericAssertionSchema } from './generic-execution.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const revisionHash = (original, number, content) => createHash('sha256').update(JSON.stringify(canonical({ original, number, content }))).digest('hex');
const identity = { planId: z.string().uuid(), revision: z.number().int().positive(), version: z.number().int().positive() };
const editSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit-scenario'), scenarioId: z.string(), title: z.string().trim().min(1).max(200), steps: ticketPlanSchema.shape.scenarios.element.shape.steps, assertionDescriptions: z.array(z.string().trim().min(1).max(1000)).min(1).max(5) }).strict(),
  z.object({ type: z.literal('remove-scenario'), scenarioId: z.string() }).strict(),
  z.object({ type: z.literal('assumption'), id: z.string(), decision: z.enum(['unresolved', 'confirmed', 'rejected']), note: z.string().trim().max(4000) }).strict(),
  z.object({ type: z.literal('criterion'), criterionId: z.string(), confirmed: z.boolean(), note: z.string().trim().max(4000) }).strict(),
  z.object({ type: z.literal('start-review') }).strict(),
  z.object({ type: z.literal('fork') }).strict(),
  z.object({ type: z.literal('approve'), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('confirm-execution'), note: z.string().trim().min(1).max(4000) }).strict(),
]);
const mutationSchema = z.object({ ...identity, action: editSchema }).strict();

/** A desktop-only repository, without legacy navigation/execution dependencies. */
export class PlanStore {
  constructor(path) {
    if (path !== ':memory:') {
      path = resolve(path); privateDirectory(dirname(path));
      for (const suffix of ['', '-journal', '-wal', '-shm']) assertNoSymlinks(path + suffix);
    }
    this.db = new DatabaseSync(path);
    this.path = path;
    try {
      if (path !== ':memory:') chmodSync(path, 0o600);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 1, 2].includes(version)) throw new Error('Plan database version is unsupported.');
      this.backupPath = backupBeforeConsolidation(this.db, path);
      this.projectBackupPath = this.backupPath ? null : backupBeforeProjectFoundation(this.db, path);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS desktop_plans (id TEXT PRIMARY KEY, original_json TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_plan_revisions (
          plan_id TEXT NOT NULL REFERENCES desktop_plans(id), number INTEGER NOT NULL, version INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('DRAFT','IN_REVIEW','APPROVED')), content_json TEXT NOT NULL,
          hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(plan_id,number));
        CREATE TABLE IF NOT EXISTS desktop_plan_approvals (
          id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, approved_at TEXT NOT NULL,
          reviewer TEXT NOT NULL, UNIQUE(plan_id,revision), FOREIGN KEY(plan_id,revision) REFERENCES desktop_plan_revisions(plan_id,number));
        CREATE TABLE IF NOT EXISTS desktop_plan_events (
          id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL, type TEXT NOT NULL,
          details_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(plan_id,revision) REFERENCES desktop_plan_revisions(plan_id,number));
        CREATE TABLE IF NOT EXISTS desktop_plan_executions (
          id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL, report_json TEXT NOT NULL,
          FOREIGN KEY(plan_id,revision) REFERENCES desktop_plan_revisions(plan_id,number));
        CREATE TRIGGER IF NOT EXISTS freeze_approved_update BEFORE UPDATE ON desktop_plan_revisions WHEN OLD.status='APPROVED' BEGIN SELECT RAISE(ABORT,'Approved revisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS freeze_approved_delete BEFORE DELETE ON desktop_plan_revisions WHEN OLD.status='APPROVED' BEGIN SELECT RAISE(ABORT,'Approved revisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS freeze_original BEFORE UPDATE ON desktop_plans BEGIN SELECT RAISE(ABORT,'Original ticket is immutable'); END;
      `);
      this.knowledge = new KnowledgeStore(this);
      this.conversations = new ConversationStore(this);
      // A new desktop process cannot resume ownership of an earlier browser run.
      for (const row of this.db.prepare('SELECT report_json FROM desktop_plan_executions').all()) {
        const report = JSON.parse(row.report_json);
        if (report.status !== 'RUNNING') continue;
        report.status = 'COMPLETED'; report.outcome = report.scenarios.some(item => item.outcome === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE';
        report.completedAt = new Date().toISOString(); report.gaps.push('Execution interrupted before completion; remaining scenarios were not run.');
        for (const item of report.scenarios) if (item.status === 'RUNNING') { item.status = 'INTERRUPTED'; if (item.outcome !== 'FAIL') item.outcome = 'INCONCLUSIVE'; }
        this.saveExecution(report);
      }
      for (const row of this.db.prepare('SELECT report_json FROM desktop_plan_executions').all()) this.conversations.linkReport(JSON.parse(row.report_json));
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  saveExecution(report) {
    this.db.prepare(`INSERT INTO desktop_plan_executions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_json=excluded.report_json`).run(report.id, report.planId, report.revision, JSON.stringify(report));
  }
  executions(planId, revision) {
    z.string().uuid().parse(planId); z.number().int().positive().parse(revision);
    return this.db.prepare('SELECT report_json FROM desktop_plan_executions WHERE plan_id=? AND revision=? ORDER BY rowid DESC LIMIT 20').all(planId, revision).map(row => JSON.parse(row.report_json));
  }
  executionReport(input) {
    const request = z.object({ planId: z.string().uuid(), reportId: z.string().uuid() }).strict().parse(input);
    const row = this.db.prepare('SELECT report_json FROM desktop_plan_executions WHERE id=? AND plan_id=?').get(request.reportId, request.planId);
    if (!row) throw new Error('Linked report not found.');
    return JSON.parse(row.report_json);
  }
  atomic(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(planId, revision, type, details) {
    this.db.prepare('INSERT INTO desktop_plan_events(plan_id,revision,type,details_json,created_at) VALUES(?,?,?,?,?)').run(planId, revision, type, JSON.stringify(details), new Date().toISOString());
  }
  create(input, { executionRequired = false } = {}) {
    const parsed = ticketPlanSchema.parse(input);
    const { ticket, version, status, proposalSource, ...draft } = parsed;
    const original = validateTicketPlan(ticket, draft);
    const planId = randomUUID(), content = initialReview(original), now = new Date().toISOString();
    if (executionRequired) content.executionRequired = true;
    this.atomic(() => {
      this.db.prepare('INSERT INTO desktop_plans VALUES(?,?,?)').run(planId, JSON.stringify(original), now);
      this.db.prepare('INSERT INTO desktop_plan_revisions VALUES(?,?,?,?,?,?,?,?)').run(planId, 1, 1, 'DRAFT', JSON.stringify(content), revisionHash(original, 1, content), now, now);
      this.event(planId, 1, 'generated', { source: 'ai' });
    });
    return this.get(planId);
  }
  bindExecution(planId, version, binding, revision) {
    return this.atomic(() => {
      const current = this.get(planId);
      if (current.status === 'APPROVED' || current.version !== version || (revision !== undefined && current.revision !== revision)) throw new Error('Executable preparation requires the unchanged unapproved revision.');
      const content = structuredClone(current.content);
      content.execution = binding;
      const conversation = this.conversations.forPlan(planId);
      if (!conversation || binding.context.projectId !== conversation.projectId || binding.context.mode !== conversation.context.mode || binding.context.url !== conversation.context.url) throw new Error('Executable context does not match its conversation.');
      for (const item of binding.scenarios) {
        const plan = normalizePlan(JSON.parse(item.planJson));
        const scenario = content.scenarios.find(scenario => scenario.id === item.scenarioId);
        if (!scenario || plan.id !== scenario.id) throw new Error('Executable scenario identity changed.');
        const final = plan.steps.slice(-scenario.assertions.length);
        for (const [index, source] of scenario.assertions.entries()) {
          const assertion = genericAssertionSchema.parse(JSON.parse(item.assertionSources[index]?.assertionJson ?? 'null'));
          const kind = { url: 'url', text: 'text', visibility: 'visible', behavior: 'enabled' }[source.kind];
          if (kind !== assertion.kind || (source.exactValue !== null && source.exactValue !== String(assertion.expected)) || final[index]?.kind !== 'assert' || JSON.stringify(final[index].assertion) !== JSON.stringify(assertion)) throw new Error('Executable binding changed an original assertion.');
        }
      }
      content.criteria.forEach(item => { item.confirmed = false; item.note = ''; });
      validateReviewContent(current.original, content);
      const hash = revisionHash(current.original, current.revision, content);
      this.db.prepare("UPDATE desktop_plan_revisions SET version=version+1,status='DRAFT',content_json=?,hash=?,updated_at=? WHERE plan_id=? AND number=?").run(JSON.stringify(content), hash, new Date().toISOString(), planId, current.revision);
      this.event(planId, current.revision, 'prepared-executable-draft', { previousHash: current.hash, hash });
      return this.get(planId);
    });
  }
  list() {
    return this.db.prepare(`SELECT p.id,p.original_json,r.number,r.status FROM desktop_plans p JOIN desktop_plan_revisions r ON r.plan_id=p.id
      WHERE r.number=(SELECT MAX(number) FROM desktop_plan_revisions WHERE plan_id=p.id) ORDER BY p.created_at DESC LIMIT 100`).all()
      .map(row => ({ id: row.id, title: JSON.parse(row.original_json).ticket.title, revision: row.number, status: row.status }));
  }
  get(planId, revision) {
    z.string().uuid().parse(planId);
    if (revision !== undefined) z.number().int().positive().parse(revision);
    const record = this.db.prepare('SELECT * FROM desktop_plans WHERE id=?').get(planId);
    if (!record) throw new Error('Saved plan not found.');
    const original = ticketPlanSchema.parse(JSON.parse(record.original_json));
    const row = revision === undefined ? this.db.prepare('SELECT * FROM desktop_plan_revisions WHERE plan_id=? ORDER BY number DESC LIMIT 1').get(planId) : this.db.prepare('SELECT * FROM desktop_plan_revisions WHERE plan_id=? AND number=?').get(planId, revision);
    if (!row) throw new Error('Saved revision not found.');
    const content = validateReviewContent(original, JSON.parse(row.content_json));
    if (revisionHash(original, row.number, content) !== row.hash) throw new Error('Saved revision failed integrity validation.');
    const approvals = this.db.prepare('SELECT id,revision,hash,approved_at AS approvedAt,reviewer FROM desktop_plan_approvals WHERE plan_id=? ORDER BY revision').all(planId);
    if (row.status === 'APPROVED' && !approvals.some(item => item.revision === row.number && item.hash === row.hash)) throw new Error('Saved approval does not match its revision.');
    return {
      planId, revision: row.number, version: row.version, status: row.status, hash: row.hash, original, content,
      coverage: plannedCoverage(original, content), issues: approvalIssues(original, content), approvals,
      revisions: this.db.prepare('SELECT number,status FROM desktop_plan_revisions WHERE plan_id=? ORDER BY number').all(planId),
      events: this.db.prepare('SELECT revision,type,details_json,created_at AS createdAt FROM desktop_plan_events WHERE plan_id=? ORDER BY id').all(planId).map(item => ({ revision: item.revision, type: item.type, details: JSON.parse(item.details_json), createdAt: item.createdAt })),
    };
  }
  mutate(input) {
    const request = mutationSchema.parse(input);
    return this.atomic(() => {
      const current = this.get(request.planId);
      if (current.revision !== request.revision || current.version !== request.version) throw new Error('Plan changed. Reopen the latest revision before saving.');
      const action = request.action;
      if (action.type === 'fork') {
        if (current.status !== 'APPROVED') throw new Error('Only an approved revision needs a new revision.');
        const number = current.revision + 1, content = initialReview(current.original), now = new Date().toISOString();
        content.scenarios = structuredClone(current.content.scenarios);
        if (current.content.executionRequired) content.executionRequired = true;
        this.db.prepare('INSERT INTO desktop_plan_revisions VALUES(?,?,?,?,?,?,?,?)').run(current.planId, number, 1, 'DRAFT', JSON.stringify(content), revisionHash(current.original, number, content), now, now);
        this.event(current.planId, number, 'forked', { fromRevision: current.revision, approvalInherited: false });
        return this.get(current.planId);
      }
      if (current.status === 'APPROVED') throw new Error('Approved revisions are frozen. Create a new DRAFT revision to make changes.');
      const content = structuredClone(current.content);
      let status = current.status;
      if (action.type === 'start-review') {
        if (status !== 'DRAFT') throw new Error('Only a DRAFT can enter review.');
        status = 'IN_REVIEW';
      } else if (action.type === 'approve') {
        if (status !== 'IN_REVIEW' || action.hash !== current.hash) throw new Error('Approve the exact current IN_REVIEW revision.');
        if (current.issues.length) throw new Error('Resolve blocking assumptions and confirm every criterion’s planned coverage before approval.');
        status = 'APPROVED';
      } else if (action.type === 'criterion') {
        if (status !== 'IN_REVIEW') throw new Error('Start review before confirming planned coverage.');
        const item = content.criteria.find(item => item.criterionId === action.criterionId);
        if (!item) throw new Error('Unknown criterion.');
        const coverage = current.coverage.find(item => item.criterionId === action.criterionId);
        if (action.confirmed && (!coverage.scenarioIds.length || coverage.blockingAssumptionIds.length)) throw new Error('Coverage needs a retained scenario and confirmed assumptions.');
        Object.assign(item, { confirmed: action.confirmed, note: action.note });
      } else if (action.type === 'confirm-execution') {
        if (!content.execution) throw new Error('Prepare commands first.');
        content.execution.note = action.note;
        content.criteria.forEach(item => { item.confirmed = false; item.note = ''; });
        status = 'DRAFT';
      } else {
        let affected;
        if (action.type === 'assumption') {
          const item = content.assumptions.find(item => item.id === action.id);
          if (!item) throw new Error('Unknown assumption.');
          Object.assign(item, { decision: action.decision, note: action.note });
          affected = content.scenarios.filter(item => item.assumptionIds.includes(action.id)).map(item => item.criterionId);
        } else {
          const scenario = content.scenarios.find(item => item.id === action.scenarioId);
          if (!scenario) throw new Error('Scenario not found.');
          affected = [scenario.criterionId];
          if (action.type === 'remove-scenario') content.scenarios = content.scenarios.filter(item => item.id !== action.scenarioId);
          else {
            if (action.assertionDescriptions.length !== scenario.assertions.length) throw new Error('Keep the original assertion count.');
            scenario.title = action.title; scenario.steps = action.steps;
            scenario.assertions.forEach((item, index) => { item.description = action.assertionDescriptions[index]; });
          }
        }
        content.criteria.filter(item => affected.includes(item.criterionId)).forEach(item => { item.confirmed = false; item.note = ''; });
        status = 'DRAFT';
        delete content.execution;
      }
      validateReviewContent(current.original, content);
      const hash = revisionHash(current.original, current.revision, content), now = new Date().toISOString();
      this.db.prepare('UPDATE desktop_plan_revisions SET version=version+1,status=?,content_json=?,hash=?,updated_at=? WHERE plan_id=? AND number=?').run(status, JSON.stringify(content), hash, now, current.planId, current.revision);
      if (status === 'APPROVED') this.db.prepare('INSERT INTO desktop_plan_approvals VALUES(?,?,?,?,?,?)').run(randomUUID(), current.planId, current.revision, hash, now, 'local-user');
      this.event(current.planId, current.revision, action.type, { action, previousHash: current.hash, hash, status });
      return this.get(current.planId);
    });
  }
}
