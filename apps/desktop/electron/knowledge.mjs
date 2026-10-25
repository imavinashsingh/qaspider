import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { normalizePlan } from './generic-execution.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeSchema = z.object(Object.fromEntries(['project', 'environment', 'role', 'application'].map(key => [key, z.string().min(1).max(100)]))).strict();
// Trusted fixture identity is stable across random ports and desktop restarts.
// Renderer requests cannot choose a different project, role or application.
export const fixtureKnowledgeScope = environment => Object.freeze({ project: 'qaspider-controlled', environment, role: 'synthetic-tester', application: 'owned-qa-apps-v1' });
export const operationKey = input => hash(normalizePlan(input).steps.map(({ value, ...step }) => step));
const searchTerms = input => [...new Set((input.match(/[a-zA-Z0-9_-]+/g) ?? []).slice(0, 30))].map(word => `"${word}"`).join(' OR ');

/** Uses the existing PlanStore connection and execution/evidence records. No browser or provider ownership. */
export class KnowledgeStore {
  constructor(store) {
    this.store = store; this.db = store.db;
    store.atomic(() => {
      this.db.exec(readFileSync(new URL('./knowledge.sql', import.meta.url), 'utf8'));
      for (const table of ['desktop_knowledge_revisions', 'desktop_knowledge_verifications', 'desktop_knowledge_findings']) {
        for (const operation of ['UPDATE', 'DELETE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS freeze_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Knowledge history is append-only'); END;`);
      }
      this.db.exec('PRAGMA user_version=2');
    });
  }
  find(scope, input) {
    scope = scopeSchema.parse(scope);
    const key = operationKey(input), terms = searchTerms(normalizePlan(input).steps[0].path);
    // FTS generates candidates, exact operation and four-part scope determine eligibility.
    const rows = this.db.prepare(`SELECT r.* FROM desktop_workflow_search f JOIN desktop_workflows w ON w.id=f.workflow_id
      JOIN desktop_knowledge_scopes s ON s.id=w.scope_id JOIN desktop_knowledge_revisions r ON r.workflow_id=w.id
      WHERE desktop_workflow_search MATCH ? AND s.project=? AND s.environment=? AND s.role=? AND s.application=? AND w.operation_key=?
      AND r.number=(SELECT MAX(number) FROM desktop_knowledge_revisions WHERE workflow_id=w.id) AND r.status='VERIFIED'
      AND NOT EXISTS(SELECT 1 FROM desktop_knowledge_findings finding WHERE finding.revision_id=r.id)
      LIMIT 1`).all(terms, scope.project, scope.environment, scope.role, scope.application, key);
    return rows[0] ? { id: rows[0].id, number: rows[0].number, steps: JSON.parse(rows[0].steps_json) } : null;
  }
  record(scope, input, executionId, scenarioId) {
    scope = scopeSchema.parse(scope);
    const execution = this.db.prepare('SELECT report_json FROM desktop_plan_executions WHERE id=?').get(executionId);
    if (!execution) throw new Error('Knowledge requires a persisted execution.');
    const saved = JSON.parse(execution.report_json), scenario = saved.scenarios.find(item => item.scenarioId === scenarioId), result = scenario?.result;
    if (saved.status !== 'COMPLETED' || !result?.knowledge || saved.environment !== scope.environment || hash(saved.knowledgeScope) !== hash(scope)) throw new Error('Knowledge requires completed scoped evidence.');
    const approved = this.store.get(saved.planId, saved.revision);
    if (approved.status !== 'APPROVED' || approved.hash !== saved.hash) throw new Error('Knowledge requires exact approved execution identity.');
    const evidence = new Map(result.evidence.map(item => [item.id, item]));
    const verified = !saved.interrupted && scenario.outcome === 'PASS' && result.outcome === 'PASS' && result.browserClosed && result.assertionsExecuted > 0 && result.steps.length === normalizePlan(input).steps.length && result.knowledge.steps.length === result.steps.length && result.steps.every(step => step.outcome === 'PASS' && evidence.has(step.evidenceId)) && result.knowledge.steps.every((step, index) => step.number === index + 1 && evidence.has(step.evidenceId));
    const knowledge = result.knowledge, key = operationKey(input), scopeId = hash(scope);
    // No plan inputs, credentials, model payloads or screenshot copies enter knowledge tables.
    const secrets = normalizePlan(input).steps.filter(step => step.kind === 'FILL' && step.value).map(step => step.value);
    const steps = knowledge.steps.map(step => ({ number: step.number, kind: step.kind, selector: step.selector, before: step.before, after: step.after, evidenceId: step.evidenceId }));
    if (secrets.some(secret => JSON.stringify(steps).includes(secret))) throw new Error('Input literal found in operational knowledge.');
    return this.store.atomic(() => {
      if (this.db.prepare('SELECT 1 FROM desktop_knowledge_verifications WHERE execution_id=? AND scenario_id=?').get(executionId, scenarioId)) return;
      this.db.prepare('INSERT OR IGNORE INTO desktop_knowledge_scopes VALUES(?,?,?,?,?)').run(scopeId, scope.project, scope.environment, scope.role, scope.application);
      let workflow = this.db.prepare('SELECT id FROM desktop_workflows WHERE scope_id=? AND operation_key=?').get(scopeId, key);
      if (!workflow) {
        workflow = { id: randomUUID() };
        const description = `${normalizePlan(input).steps[0].path} workflow`;
        this.db.prepare('INSERT INTO desktop_workflows VALUES(?,?,?,?)').run(workflow.id, scopeId, key, description);
        this.db.prepare('INSERT INTO desktop_workflow_search(workflow_id,description) VALUES(?,?)').run(workflow.id, description + ' ' + normalizePlan(input).steps.map(step => step.kind).join(' '));
      }
      const previous = this.db.prepare('SELECT * FROM desktop_knowledge_revisions WHERE workflow_id=? ORDER BY number DESC LIMIT 1').get(workflow.id);
      let revisionId = previous?.id;
      const timestamp = new Date().toISOString();
      for (const finding of knowledge.findings) {
        if (!previous || finding.revisionId !== previous.id || !evidence.has(finding.evidenceId)) throw new Error('Divergence requires original revision and failure evidence.');
        this.db.prepare('INSERT INTO desktop_knowledge_findings VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), previous.id, executionId, scenarioId, finding.stepNumber, finding.evidenceId, finding.reason, timestamp);
      }
      if (!previous || !verified || knowledge.findings.length || knowledge.metrics.reusedSteps === 0) {
        revisionId = randomUUID();
        this.db.prepare('INSERT INTO desktop_knowledge_revisions VALUES(?,?,?,?,?,?,?,?)').run(revisionId, workflow.id, (previous?.number ?? 0) + 1, verified ? 'VERIFIED' : 'CANDIDATE', JSON.stringify(steps), executionId, scenarioId, timestamp);
      }
      this.db.prepare('INSERT INTO desktop_knowledge_verifications VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), revisionId, executionId, scenarioId, verified ? 'PASS' : result.outcome, knowledge.metrics.reusedSteps, JSON.stringify(knowledge.metrics), timestamp);
    });
  }
  list(query = '') {
    const terms = searchTerms(z.string().max(500).parse(query));
    const rows = terms ? this.db.prepare(`SELECT w.*,s.project,s.environment,s.role,s.application FROM desktop_workflows w JOIN desktop_knowledge_scopes s ON s.id=w.scope_id JOIN desktop_workflow_search f ON f.workflow_id=w.id WHERE desktop_workflow_search MATCH ? ORDER BY w.rowid DESC LIMIT 100`).all(terms)
      : this.db.prepare('SELECT w.*,s.project,s.environment,s.role,s.application FROM desktop_workflows w JOIN desktop_knowledge_scopes s ON s.id=w.scope_id ORDER BY w.rowid DESC LIMIT 100').all();
    return rows.map(row => ({ ...row,
      revisions: this.db.prepare('SELECT * FROM desktop_knowledge_revisions WHERE workflow_id=? ORDER BY number DESC').all(row.id).map(({ steps_json, ...revision }) => ({ ...revision, steps: JSON.parse(steps_json) })),
      verifications: this.db.prepare('SELECT v.* FROM desktop_knowledge_verifications v JOIN desktop_knowledge_revisions r ON r.id=v.revision_id WHERE r.workflow_id=? ORDER BY v.rowid DESC').all(row.id).map(({ metrics_json, ...verification }) => ({ ...verification, metrics: JSON.parse(metrics_json) })),
      findings: this.db.prepare('SELECT f.* FROM desktop_knowledge_findings f JOIN desktop_knowledge_revisions r ON r.id=f.revision_id WHERE r.workflow_id=? ORDER BY f.rowid DESC').all(row.id),
    }));
  }
}
