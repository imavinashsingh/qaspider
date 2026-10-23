import { afterEach, expect, it } from 'vitest';
import { SqliteStore } from '../../packages/storage/src/index.js';
import { policySchema } from '../../packages/core/src/testing.js';
const stores: SqliteStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() { const store = new SqliteStore(':memory:'); stores.push(store); store.createApplication({ id: 'app', name: 'App' }); store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['http://localhost:3000'] }); store.createRole({ id: 'guest', environmentId: 'qa', name: 'Guest', auth: { kind: 'guest' } }); const story = store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Invalid email is rejected.', 'story.md', { applicationId: 'app', environmentId: 'qa', build: 'b1', tenant: 'public', featureFlags: {}, roleIds: ['guest'] }); return { store, story }; }
const policy = policySchema.parse({ actionGrants: [], readGrants: [], fixtures: null, discovery: false });
function proposal(requirementId: string) { return { title: 'Registration', feature: 'Registration', inferredRequirements: [], scenarios: [{ id: 'invalid', title: 'Invalid email', roleId: 'guest', requirementIds: [requirementId], targetStateId: 'state', data: [], steps: [], assertions: [{ id: 'error', requirementId, kind: 'text' as const, locator: { kind: 'role' as const, role: 'heading' as const, name: 'Error' }, expected: 'Invalid email', comparison: 'equals' as const }], allowedActions: [], cleanup: 'owned-fixtures' as const, severity: 'medium' as const, retries: 0 }] }; }
it('pins immutable story, requirement and approved plan revisions and rejects stale approval', () => {
    const { store, story } = setup();
    const req = story.requirements[0]!;
    const first = store.testing.savePlan(story.id, proposal(req.id), policy, { id: 'fake', synthetic: true, validationId: null });
    expect(() => store.testing.startRun(first.id)).toThrow('approved');
    const edited = store.testing.revisePlan(first.id, { ...first.proposal, title: 'Reviewed plan' });
    expect(() => store.testing.approvePlan(first.id, 'owner', [req.id])).toThrow('latest');
    store.testing.approvePlan(edited.id, 'owner', [req.id]);
    const approved = store.testing.getPlan(edited.id)!;
    expect(approved.status).toBe('approved');
    expect(approved.proposal.title).toBe('Reviewed plan');
    expect(store.testing.getPlan(first.id)?.proposal.title).toBe('Registration');
    const run = store.testing.startRun(edited.id);
    expect(store.testing.report(run.id)?.results[0]?.status).toBe('NOT RUN');
    const next = store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Invalid email remains rejected.', 'story.md', story.context, story.storyId);
    expect(next.revision).toBe(2);
    expect(store.testing.getStory(story.id)?.requirements[0]?.text).toBe(req.text);
});
it('keeps inferred requirements proposed, enforces scoped role/grant validation and prevents unsupported PASS', () => {
    const { store, story } = setup();
    const req = story.requirements[0]!;
    const inferred = store.testing.addInference(story.id, 'Hypothesis', 'codex');
    expect(inferred.approved).toBe(false);
    const plan = store.testing.savePlan(story.id, proposal(inferred.id), policy, { id: 'codex', synthetic: false, validationId: 'probe' });
    expect(() => store.testing.approvePlan(plan.id, 'owner', [])).toThrow('requirement');
    expect(() => store.testing.savePlan(story.id, { ...proposal(req.id), scenarios: [{ ...proposal(req.id).scenarios[0]!, roleId: 'admin' }] }, policy, { id: 'fake', synthetic: true, validationId: null })).toThrow();
    const valid = store.testing.savePlan(story.id, proposal(req.id), policy, { id: 'fake', synthetic: true, validationId: null });
    store.testing.approvePlan(valid.id, 'owner', [req.id]);
    const run = store.testing.startRun(valid.id);
    expect(() => store.testing.recordAttempt(run.id, 'invalid', 1, { status: 'PASS', reason: '', assertions: [], evidenceIds: [], navigationRunId: null })).toThrow();
});
it('rejects external form/read grants and real-provider provenance without isolation validation', () => {
    const { store, story } = setup();
    const base = proposal(story.requirements[0]!.id);
    const provider = { id: 'fixture', synthetic: true, validationId: null };
    expect(() => store.testing.savePlan(story.id, base, { ...policy, actionGrants: [{ roleId: 'guest', url: 'https://evil.test/write', method: 'POST' }] }, provider)).toThrow('scope');
    expect(() => store.testing.savePlan(story.id, base, policy, { id: 'codex', synthetic: false, validationId: null })).toThrow();
    expect(() => store.testing.savePlan(story.id, { ...base, scenarios: [{ ...base.scenarios[0]!, steps: [{ kind: 'click', locator: { kind: 'role', role: 'button', name: 'Submit' }, submitUrl: 'http://localhost:3000/register' }] }] }, policy, provider)).toThrow('Submission');
    expect(() => store.testing.savePlan(story.id, { ...base, scenarios: [{ ...base.scenarios[0]!, assertions: [{ id: 'status', requirementId: story.requirements[0]!.id, kind: 'http-status', url: 'https://evil.test/', expected: 200 }] }] }, policy, provider)).toThrow('read grant');
});
it('rolls back partial requirement approvals atomically when a plan still cites an unapproved criterion', () => {
    const { store, story } = setup();
    const inference = store.testing.addInference(story.id, 'Explicitly review this inferred criterion', 'codex');
    const base = proposal(story.requirements[0]!.id);
    const inferredCase = { ...base.scenarios[0]!, id: 'inferred', requirementIds: [inference.id], assertions: base.scenarios[0]!.assertions.map(a => ({ ...a, requirementId: inference.id })) };
    const plan = store.testing.savePlan(story.id, { ...base, scenarios: [...base.scenarios, inferredCase] }, policy, { id: 'fixture', synthetic: true, validationId: null });
    expect(() => store.testing.approvePlan(plan.id, 'owner', [story.requirements[0]!.id])).toThrow('requirement');
    expect(store.testing.getStory(story.id)?.requirements.every(r => !r.approved)).toBe(true);
    expect(store.testing.getPlan(plan.id)?.status).toBe('draft');
});
