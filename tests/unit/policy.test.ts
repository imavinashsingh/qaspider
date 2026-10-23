import { describe, expect, it } from 'vitest';
import { evaluateAction, scopeSchema, approvalSchema } from '../../packages/core/src/index.js';
const policy = { allowedOrigins: ['http://127.0.0.1:3000'], environment: 'qa' as const, allowProductionWrites: false };
describe('policy defaults', () => {
  it('permits declared safe navigation and denies other origins, schemes and embedded credentials', () => {
    expect(evaluateAction(policy, { url: 'http://127.0.0.1:3000/home', kind: 'navigate' }).allowed).toBe(true);
    for (const url of ['https://evil.test', 'javascript:alert(1)', 'http://secret:pass@127.0.0.1:3000', 'http://127.0.0.1:3001']) {
      expect(evaluateAction(policy, { url, kind: 'navigate' }).allowed).toBe(false);
    }
  });
  it('denies undeclared actions, fixture writes and privileged actions without scoped permission', () => {
    expect(evaluateAction(policy, { url: policy.allowedOrigins[0]!, kind: 'delete' }).allowed).toBe(false);
    expect(evaluateAction(policy, { url: policy.allowedOrigins[0]!, kind: 'fixture-write' }).allowed).toBe(false);
    expect(evaluateAction(policy, { url: policy.allowedOrigins[0]!, kind: 'fixture-write' }, [{ origin: policy.allowedOrigins[0]!, kind: 'fixture-write' }]).allowed).toBe(true);
    expect(evaluateAction({ ...policy, environment: 'production' }, { url: policy.allowedOrigins[0]!, kind: 'fixture-write' }, [{ origin: policy.allowedOrigins[0]!, kind: 'fixture-write' }]).allowed).toBe(false);
    expect(evaluateAction(policy, { url: policy.allowedOrigins[0]!, kind: 'unknown' } as never).allowed).toBe(false);
  });
  it('requires complete role/tenant/build scope and separates batch from expectation approval', () => {
    const scope = { applicationId: 'app', environmentId: 'qa', build: 'b1', roleId: 'guest', tenant: 'public', featureFlags: {} };
    expect(scopeSchema.safeParse(scope).success).toBe(true);
    expect(scopeSchema.safeParse({ ...scope, roleId: '' }).success).toBe(false);
    expect(approvalSchema.safeParse({ kind: 'navigation-batch', scope, candidateIds: ['a'], approvedBy: 'owner' }).success).toBe(true);
    expect(approvalSchema.safeParse({ kind: 'business-rule', scope, candidateIds: ['a', 'b'], approvedBy: 'owner' }).success).toBe(false);
    expect(approvalSchema.safeParse({ kind: 'security-expectation', scope, candidateId: 'a', approvedBy: 'owner', authoritativeSource: 'spec:AC2' }).success).toBe(true);
  });
});
