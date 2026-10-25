import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanStore } from '../electron/plan-store.mjs';
import { ApprovedExecution, requireApproved } from '../electron/approved-execution.mjs';
import { checkCompatibility } from '../electron/plan-compatibility.mjs';
import { executableProposal, approve, executionIdentity, executionRequest } from './fixtures/approved-plan.mjs';
import { testAccount } from '../demo/credentials.mjs';
import { runScenario } from '../electron/scenario-runner.mjs';
import { loginScenarios } from '../electron/scenarios.mjs';

function setup(runner) {
  const store = new PlanStore(':memory:');
  const saved = approve(store, store.create(executableProposal()));
  const service = new ApprovedExecution(store, { runner });
  return { store, saved, service };
}
// Synthetic runner receipts for adapter unit tests; real browser receipts are tested separately.
const passing = async plan => ({ scenarioId: plan.id, outcome: 'PASS', assertionsExecuted: 1, steps: plan.steps.map(() => ({ outcome: 'PASS' })), evidence: [{ id: 'synthetic-evidence' }], browserClosed: true });
describe('exact approved ticket execution', () => {
  it('rejects drafts, stale hashes, new revisions and modified SQLite records', () => {
    const { store, saved } = setup();
    try {
      expect(requireApproved(store, executionIdentity(saved)).hash).toBe(saved.hash);
      expect(() => requireApproved(store, { ...executionIdentity(saved), hash: '0'.repeat(64) })).toThrow();
      const draft = store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action: { type: 'fork' } });
      expect(() => requireApproved(store, executionIdentity(saved))).toThrow();
      expect(() => requireApproved(store, executionIdentity(draft))).toThrow();
      const content = structuredClone(draft.content); content.scenarios[0].title = 'Tampered';
      store.db.prepare('UPDATE desktop_plan_revisions SET content_json=? WHERE plan_id=? AND number=?').run(JSON.stringify(content), draft.planId, draft.revision);
      expect(() => store.get(draft.planId)).toThrow('integrity');
    } finally { store.close(); }
  });
  it('classifies unsupported prose, unknown preconditions and conflicting source expectations without editing', () => {
    const { store, saved } = setup();
    try {
      expect(checkCompatibility(saved).every(item => item.classification === 'EXECUTABLE')).toBe(true);
      const copy = structuredClone(saved); copy.content.scenarios[0].steps[0].instruction = 'Open registration';
      expect(checkCompatibility(copy)[0].classification).toBe('UNSUPPORTED');
      const config = structuredClone(saved); config.content.scenarios[0].preconditions.push('An existing email account');
      expect(checkCompatibility(config)[0].classification).toBe('CONFIGURATION_REQUIRED');
      const conflict = structuredClone(saved); conflict.content.scenarios[0].assertions[0].exactValue = '/other';
      expect(checkCompatibility(conflict)[0].classification).toBe('UNSUPPORTED');
      expect(saved.content.scenarios[0].steps[0].instruction).toContain('navigate');
    } finally { store.close(); }
  });
  it('executes only approved scenarios and persists redacted results', async () => {
    const calls = [], { store, saved, service } = setup(async (plan, options) => { calls.push(plan.id); expect(options.authorized).toBe(true); return { ...await passing(plan), message: testAccount.password }; });
    try {
      const prep = await service.prepare(executionIdentity(saved));
      const report = await service.execute(executionRequest(saved, prep));
      expect(calls).toEqual(['S-1', 'S-2']); expect(report.outcome).toBe('PASS');
      expect(report.coverage.every(item => item.verified)).toBe(true);
      expect(store.executions(saved.planId, saved.revision)[0]).toEqual(report);
      expect(JSON.stringify(report)).not.toContain(testAccount.password);
    } finally { await service.close(); store.close(); }
  });
  it('requires separate authorization, exact origin and revision and one-use preparation', async () => {
    let calls = 0; const { store, saved, service } = setup(async plan => { calls++; return passing(plan); });
    try {
      const prep = await service.prepare(executionIdentity(saved)), request = executionRequest(saved, prep);
      await expect(service.execute({ ...request, authorized: false })).rejects.toThrow();
      await expect(service.execute({ ...request, origin: 'https://production.example' })).rejects.toThrow();
      await service.execute(request);
      await expect(service.execute(request)).rejects.toThrow(); expect(calls).toBe(2);
    } finally { await service.close(); store.close(); }
  });
  it('blocks unsupported scenarios entirely and never silently skips them into PASS', async () => {
    let calls = 0; const store = new PlanStore(':memory:'); const proposal = executableProposal(); proposal.scenarios[0].steps[0].instruction = 'Open registration';
    const saved = approve(store, store.create(proposal)); const service = new ApprovedExecution(store, { runner: async plan => { calls++; return passing(plan); } });
    try {
      const prep = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, prep));
      expect(report.outcome).toBe('BLOCKED'); expect(calls).toBe(1); expect(report.scenarios[0].outcome).toBe('BLOCKED'); expect(report.coverage[0].verified).toBe(false);
    } finally { await service.close(); store.close(); }
  });
  it('rechecks SQLite approval after preparation; edited plan needs renewed approval', async () => {
    const { store, saved, service } = setup(passing);
    try {
      const prep = await service.prepare(executionIdentity(saved));
      let draft = store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action: { type: 'fork' } });
      const scenario = draft.content.scenarios[0];
      draft = store.mutate({ planId: draft.planId, revision: draft.revision, version: draft.version, action: { type: 'edit-scenario', scenarioId: scenario.id, title: 'Edited', steps: scenario.steps, assertionDescriptions: scenario.assertions.map(item => item.description) } });
      await expect(service.execute(executionRequest(saved, prep))).rejects.toThrow();
      await expect(service.prepare(executionIdentity(draft))).rejects.toThrow();
    } finally { await service.close(); store.close(); }
  });
  it('persists interrupted intent and marks unfinished scenarios NOT RUN without false PASS', async () => {
    const { store, saved, service } = setup(async () => { throw new Error('Interrupted'); });
    try {
      const prep = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, prep));
      expect(report.outcome).toBe('INCONCLUSIVE'); expect(report.scenarios.map(item => item.outcome)).toEqual(['INCONCLUSIVE', 'NOT RUN']); expect(report.gaps.length).toBeGreaterThan(0);
    } finally { await service.close(); store.close(); }
  });
  it('recovers a crashed process report from SQLite with evidence intact', () => {
    const folder = mkdtempSync(join(tmpdir(), 'm43-recovery-')), path = join(folder, 'plans.sqlite'); let store = new PlanStore(path);
    try {
      const saved = approve(store, store.create(executableProposal()));
      store.saveExecution({ id: 'run', planId: saved.planId, revision: saved.revision, status: 'RUNNING', outcome: 'INCONCLUSIVE', scenarios: [{ status: 'RUNNING', outcome: 'FAIL', evidence: ['retained'] }, { status: 'NOT RUN', outcome: 'NOT RUN' }], gaps: [] });
      store.close(); store = new PlanStore(path); const report = store.executions(saved.planId, saved.revision)[0];
      expect(report.outcome).toBe('FAIL'); expect(report.scenarios[0].evidence).toEqual(['retained']); expect(report.scenarios[1].outcome).toBe('NOT RUN'); expect(report.completedAt).toBeTruthy();
    } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
  });
  it('summarizes assertion failures as FAIL even alongside other passing scenarios', async () => {
    const { store, saved, service } = setup(async plan => ({ ...await passing(plan), outcome: plan.id === 'S-1' ? 'FAIL' : 'PASS' }));
    try { const prep = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, prep)); expect(report.outcome).toBe('FAIL'); expect(report.coverage[0].verified).toBe(false); }
    finally { await service.close(); store.close(); }
  });
  it('denies browser actions without an owned fixture even for valid commands', async () => {
    expect((await runScenario(loginScenarios()[0], { fixture: { origin: 'http://127.0.0.1:1234' }, authorized: true })).outcome).toBe('BLOCKED');
  });
  it('does not trust a PASS receipt missing assertion evidence or cleanup', async () => {
    const { store, saved, service } = setup(async plan => ({ ...await passing(plan), assertionsExecuted: 0, evidence: [], browserClosed: false }));
    try { const prep = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, prep)); expect(report.outcome).toBe('INCONCLUSIVE'); }
    finally { await service.close(); store.close(); }
  });
  it('rejects an expired preparation even before its cleanup timer fires', async () => {
    const { store, saved, service } = setup(passing);
    try { const prep = await service.prepare(executionIdentity(saved)); service.pending.expiresAt = Date.now() - 1; await expect(service.execute(executionRequest(saved, prep))).rejects.toThrow(); }
    finally { await service.close(); store.close(); }
  });
});
