import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanStore } from '../electron/plan-store.mjs';
import { parseTicket, validateTicketPlan } from '../shared/ticket-plan.mjs';
import { registrationTicket, registrationDraft } from './fixtures/ticket.mjs';

let store, snapshot;
function change(action, reference = snapshot) { snapshot = store.mutate({ planId: reference.planId, revision: reference.revision, version: reference.version, action }); return snapshot; }
function edit(scenario = snapshot.content.scenarios[0], title = 'Human-reviewed email requirement') {
  return { type: 'edit-scenario', scenarioId: scenario.id, title, steps: [{ instruction: 'Review the synthetic email input.', expectedOutcome: 'The declared email requirement is checked.' }], assertionDescriptions: scenario.assertions.map(() => 'Verify the stated email requirement.') };
}
function ready() {
  for (const item of snapshot.content.assumptions) change({ type: 'assumption', id: item.id, decision: 'confirmed', note: 'Confirmed synthetic fixture and data are available.' });
  change({ type: 'start-review' });
  for (const item of snapshot.content.criteria) change({ type: 'criterion', criterionId: item.criterionId, confirmed: true, note: 'Reviewed retained steps and assertions against this criterion.' });
}
beforeEach(() => { store = new PlanStore(':memory:'); snapshot = store.create(validateTicketPlan(parseTicket(registrationTicket), registrationDraft())); });
afterEach(() => store.close());

describe('M4.2 review lifecycle and coverage', () => {
  it('edits scenario prose and expected results without rewriting source criteria', () => {
    const original = structuredClone(snapshot.original);
    change(edit());
    expect(snapshot.content.scenarios[0].title).toBe('Human-reviewed email requirement');
    expect(snapshot.content.scenarios[0].steps[0].expectedOutcome).toContain('declared email');
    expect(snapshot.original).toEqual(original); expect(snapshot.status).toBe('DRAFT');
    expect(snapshot.events.at(-1).type).toBe('edit-scenario');
  });
  it('removes a scenario, reports a real gap, and blocks coverage confirmation', () => {
    const scenario = snapshot.content.scenarios.find(item => item.criterionId === 'AC-3');
    change({ type: 'remove-scenario', scenarioId: scenario.id });
    expect(snapshot.coverage.find(item => item.criterionId === 'AC-3')).toMatchObject({ planned: 'gap', scenarioIds: [], executed: 'NOT_EXECUTED' });
    change({ type: 'start-review' });
    expect(() => change({ type: 'criterion', criterionId: 'AC-3', confirmed: true, note: 'Mentioning AC-3 is not coverage.' })).toThrow(/retained scenario/);
  });
  it('does not treat proposed scenarios as reviewed or executed coverage', () => {
    expect(snapshot.coverage.every(item => item.planned === 'proposed' && item.executed === 'NOT_EXECUTED')).toBe(true);
    ready();
    expect(snapshot.coverage.every(item => item.planned === 'reviewed' && item.executed === 'NOT_EXECUTED')).toBe(true);
  });
  it('requires notes and blocks unresolved or rejected behavior-affecting assumptions', () => {
    change({ type: 'start-review' });
    expect(() => change({ type: 'approve', hash: snapshot.hash })).toThrow(/assumptions/);
    expect(() => change({ type: 'assumption', id: 'AS-1', decision: 'confirmed', note: '' })).toThrow();
    change({ type: 'assumption', id: 'AS-1', decision: 'rejected', note: 'Synthetic data is not available.' });
    expect(snapshot.status).toBe('DRAFT'); expect(snapshot.issues.some(item => item.includes('AS-1'))).toBe(true);
    change({ type: 'start-review' });
    expect(() => change({ type: 'criterion', criterionId: 'AC-1', confirmed: true, note: 'Cannot override rejected assumptions.' })).toThrow(/confirmed assumptions/);
  });
  it('approves only the exact reviewed revision and records a matching immutable approval', () => {
    expect(() => change({ type: 'approve', hash: snapshot.hash })).toThrow(/IN_REVIEW/);
    ready(); const hash = snapshot.hash;
    expect(() => change({ type: 'approve', hash: '0'.repeat(64) })).toThrow(/exact/);
    change({ type: 'approve', hash });
    expect(snapshot.status).toBe('APPROVED'); expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.approvals[0]).toMatchObject({ revision: 1, hash });
    expect(() => change(edit())).toThrow(/frozen/);
    expect(() => store.db.prepare('UPDATE desktop_plan_revisions SET hash=? WHERE plan_id=?').run('tampered', snapshot.planId)).toThrow(/immutable/);
  });
  it('forks approved content into unapproved revision 2 while preserving revision 1', () => {
    ready(); change({ type: 'approve', hash: snapshot.hash }); const approved = structuredClone(snapshot);
    change({ type: 'fork' });
    expect(snapshot).toMatchObject({ revision: 2, status: 'DRAFT' });
    expect(snapshot.hash).not.toBe(approved.hash);
    expect(snapshot.content.criteria.every(item => !item.confirmed)).toBe(true);
    change(edit());
    const old = store.get(snapshot.planId, 1);
    expect(old.status).toBe('APPROVED'); expect(old.content).toEqual(approved.content);
    expect(old.hash).toBe(approved.hash);
    expect(snapshot.approvals).toHaveLength(1); expect(snapshot.approvals[0].revision).toBe(1);
    expect(() => change({ type: 'approve', hash: approved.hash })).toThrow();
  });
  it('material edits during review return to DRAFT and clear affected confirmation', () => {
    ready(); const previous = snapshot.hash;
    change(edit());
    expect(snapshot.status).toBe('DRAFT'); expect(snapshot.hash).not.toBe(previous);
    expect(snapshot.content.criteria.find(item => item.criterionId === 'AC-1').confirmed).toBe(false);
    expect(snapshot.coverage.find(item => item.criterionId === 'AC-1').planned).toBe('proposed');
  });
  it('rejects stale edits, replaced source data, and missing assertions', () => {
    const stale = structuredClone(snapshot); change(edit());
    expect(() => change({ type: 'start-review' }, stale)).toThrow(/changed/);
    expect(() => change({ ...edit(), ticket: { title: 'Changed criterion' } })).toThrow();
    const forged = validateTicketPlan(parseTicket(registrationTicket), registrationDraft());
    forged.scenarios[0].assertions = [];
    expect(() => store.create(forged)).toThrow();
  });
  it('reopens approved and draft revisions with their decisions and audit records', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-review-unit-')), file = join(folder, 'plans.sqlite');
    const disk = new PlanStore(file);
    try {
      const saved = disk.create(snapshot.original);
      const apply = action => disk.mutate({ planId: saved.planId, revision: disk.get(saved.planId).revision, version: disk.get(saved.planId).version, action });
      for (const item of saved.content.assumptions) apply({ type: 'assumption', id: item.id, decision: 'confirmed', note: 'Synthetic fixtures verified.' });
      apply({ type: 'start-review' });
      for (const item of saved.content.criteria) apply({ type: 'criterion', criterionId: item.criterionId, confirmed: true, note: 'Assertions reviewed against criterion.' });
      const reviewed = disk.get(saved.planId); apply({ type: 'approve', hash: reviewed.hash });
      apply({ type: 'fork' }); disk.close();
      const reopened = new PlanStore(file);
      try {
        expect(reopened.get(saved.planId).status).toBe('DRAFT');
        expect(reopened.get(saved.planId, 1)).toMatchObject({ status: 'APPROVED', hash: reviewed.hash });
        expect(reopened.get(saved.planId).approvals[0].hash).toBe(reviewed.hash);
        expect(reopened.list()[0].revision).toBe(2);
      } finally { reopened.close(); }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
