import { describe, it, expect } from 'vitest';
import { genericStepSchema, normalizePlan, permittedUrl, runGenericScenario, resolveTarget } from '../electron/generic-execution.mjs';
import { checkCompatibility } from '../electron/plan-compatibility.mjs';
import { genericProposal, plan, navigate, check } from './fixtures/generic-plan.mjs';
import { loginScenarios } from '../electron/scenarios.mjs';
import { selectApplicationTarget, isExecutionTarget } from '../electron/execution-target.mjs';

describe('generic QA contracts and fail-closed authorization', () => {
  it('accepts any selected HTTP(S) origin while rejecting cross-origin destinations and expired capabilities', async () => {
    for (const input of ['https://unfamiliar.example:8443/start', 'http://localhost:4321/start']) {
      const selected = selectApplicationTarget(input);
      expect(isExecutionTarget(selected)).toBe(true);
      expect(permittedUrl('/another/path', selected).origin).toBe(new URL(input).origin);
      expect(() => permittedUrl('https://elsewhere.example/path', selected)).toThrow();
      expect(isExecutionTarget({ ...selected })).toBe(false);
      await selected.close();
      expect(isExecutionTarget(selected)).toBe(false);
    }
    for (const input of ['file:///tmp/app', 'https://user:password@example.com']) expect(() => selectApplicationTarget(input)).toThrow();
  });
  it('keeps login inputs and expectations explicit when translating old commands', () => {
    const converted = normalizePlan(loginScenarios()[0]);
    expect(converted.steps[0]).toEqual({ kind: 'NAVIGATE', path: '/login' });
    expect(converted.steps.at(-1)).toMatchObject(loginScenarios()[0].steps.at(-1));
  });
  it('accepts different app structures without fixture selectors in preflight', () => {
    const content = genericProposal(); const before = JSON.stringify(content);
    expect(checkCompatibility({ content }).map(item => item.classification)).toEqual(['EXECUTABLE', 'EXECUTABLE']);
    expect(JSON.stringify(content)).toBe(before);
  });
  it('accepts explicit typed assertions inside approved step instructions', () => {
    const content = genericProposal();
    content.scenarios[0].steps.push({ instruction: JSON.stringify({ kind: 'ASSERT_TEXT', selector: '#result', expected: 'Name and email are required' }), expectedOutcome: JSON.stringify({ kind: 'text', selector: '#result', expected: 'Name and email are required' }) });
    expect(checkCompatibility({ content })[0].classification).toBe('EXECUTABLE');
  });
  it('rejects unrestricted operations, missing values and unknown keys', () => {
    for (const value of [{ kind: 'EVALUATE', script: 'fetch("/.env")' }, { kind: 'FILL', target: { selector: 'input' } }, { kind: 'CLICK', target: { selector: 'button' }, script: 'alert(1)' }, { kind: 'NAVIGATE', path: '//evil.test' }]) expect(genericStepSchema.safeParse(value).success).toBe(false);
  });
  it('rejects sensitive paths and origins even on a permitted host', () => {
    const fixture = { origin: 'http://127.0.0.1:1234', paths: ['/contact'] };
    for (const value of ['/.env', 'http://localhost:1234/contact', '//evil.test/contact', '/contact/../.env']) expect(() => permittedUrl(value, fixture)).toThrow();
  });
  it('does not open a browser for forged ownership or unauthorized mutations', async () => {
    let calls = 0;
    const result = await runGenericScenario(plan([navigate('/contact'), check('Ready')]), { fixture: { origin: 'http://127.0.0.1:1234', paths: ['/contact'] }, authorized: true, openSession: async () => { calls++; } });
    expect(result.outcome).toBe('BLOCKED'); expect(calls).toBe(0);
  });
  it('does not call an observer for ambiguous controls or missing provider', async () => {
    let observes = 0;
    const session = { controlledPage: { getByRole: () => ({ count: async () => 2 }) }, stagehand: { observe: async () => { observes++; } } };
    const step = { kind: 'CLICK', target: { label: 'Submit', role: 'button', alternatives: ['Send Message'] } };
    await expect(resolveTarget(session, step, { modelAvailable: true, adaptations: [], budget: { observations: 0 } })).rejects.toThrow('ambiguous');
    session.controlledPage.getByRole = () => ({ count: async () => 0 });
    await expect(resolveTarget(session, step, { modelAvailable: false, adaptations: [], budget: { observations: 0 } })).rejects.toThrow('provider');
    expect(observes).toBe(0);
  });
});
