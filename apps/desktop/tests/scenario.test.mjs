import { describe, expect, it } from 'vitest';
import { checkPermission, redact, runScenario, runScenarioSuite, summarize } from '../electron/scenario-runner.mjs';
import { loginScenarios } from '../electron/scenarios.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';

describe('M3 scenario boundary', () => {
  it('rejects arbitrary renderer commands and missing authorization', async () => {
    expect((await runScenarioSuite({ authorized: true, scenarioIds: ['valid-login'], url: 'https://production.example/login' })).outcome).toBe('BLOCKED');
    expect((await runScenarioSuite({ authorized: false, scenarioIds: ['valid-login'] })).outcome).toBe('BLOCKED');
    expect((await runScenarioSuite({ authorized: true, scenarioIds: ['unknown'] })).outcome).toBe('BLOCKED');
  });
  it('does not grant fixture permission from a copied URL or HTML identity', async () => {
    await expect(checkPermission({ fixture: { origin: 'http://127.0.0.1:4319' }, authorized: true, step: { kind: 'navigate', path: '/login' } })).rejects.toThrow('owned controlled fixture');
  });
  it('blocks unapproved plans before opening a browser', async () => {
    const plan = loginScenarios()[0];
    expect((await runScenario({ ...plan, steps: plan.steps.filter(step => step.kind !== 'assert') })).outcome).toBe('BLOCKED');
    expect((await runScenario({ ...plan, steps: [{ kind: 'navigate', path: 'https://production.example' }, ...plan.steps.slice(1)] })).outcome).toBe('BLOCKED');
  });
  it('never embeds raw credentials in trusted plans and recursively redacts error-like values', () => {
    for (const account of [testAccount, invalidAccount]) {
      for (const secret of Object.values(account)) expect(JSON.stringify(loginScenarios())).not.toContain(secret);
      expect(redact({ message: `${account.username} / ${account.password}`, nested: [account.password] })).toEqual({ message: '[REDACTED] / [REDACTED]', nested: ['[REDACTED]'] });
    }
  });
  it('requires all scenarios to pass and preserves the deliberately failing result', () => {
    expect(summarize([]).outcome).toBe('INCONCLUSIVE');
    expect(summarize([{ outcome: 'PASS' }, { outcome: 'FAIL' }])).toMatchObject({ outcome: 'FAIL', counts: { PASS: 1, FAIL: 1 }, total: 2 });
    expect(summarize([{ outcome: 'PASS' }, { outcome: 'INCONCLUSIVE' }]).outcome).toBe('INCONCLUSIVE');
    expect(summarize([{ outcome: 'PASS' }, { outcome: 'BLOCKED' }]).outcome).toBe('BLOCKED');
  });
});
