import { describe, expect, it } from 'vitest';
import { normalizeObservation, findPath, isSafeNavigation, navigationConfigSchema, type NavigationGraph, type NavigationAction } from '../../packages/core/src/navigation.js';
const config = navigationConfigSchema.parse({});
const observed = { url: 'http://localhost:3000/home?timestamp=123', headings: ['Home'], controls: [{ role: 'link', name: 'Settings', testId: 'settings', href: 'http://localhost:3000/settings', expanded: null, selected: null }], dialogs: [] };
describe('semantic navigation identity and safety', () => {
  it('normalizes volatile URLs/text but retains meaningful state differences', () => {
    const first = normalizeObservation({ ...observed, headings: ['Home 2026-10-23T10:00:00Z'] }, config);
    const second = normalizeObservation({ ...observed, url: 'http://localhost:3000/home?timestamp=456', headings: ['Home 2026-10-23T11:00:00Z'] }, config);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(normalizeObservation({ ...observed, dialogs: ['Consent'] }, config).fingerprint).not.toBe(normalizeObservation(observed, config).fingerprint);
    expect(normalizeObservation({ ...observed, controls: [{ ...observed.controls[0]!, expanded: true }] }, config).fingerprint).not.toBe(normalizeObservation(observed, config).fingerprint);
    expect(normalizeObservation({ ...observed, url: 'http://localhost:3000/home?tab=a' }, { ...config, relevantQueryKeys: ['tab'] }).fingerprint).not.toBe(normalizeObservation({ ...observed, url: 'http://localhost:3000/home?tab=b' }, { ...config, relevantQueryKeys: ['tab'] }).fingerprint);
  });
  it('never stores secrets or input values in normalized observations', () => {
    const result = normalizeObservation({ ...observed, url: 'http://localhost:3000/?token=SECRET', headings: ['user@example.test', 'SECRET'] }, config, ['SECRET']);
    expect(JSON.stringify(result)).not.toContain('SECRET'); expect(JSON.stringify(result)).not.toContain('user@example.test');
  });
  it('allows safe links and configured controls only; rejects unknown forms, dangerous links and origins', () => {
    const action: NavigationAction = { kind: 'link', locator: { kind: 'role', role: 'link', name: 'Settings' }, targetUrl: 'http://localhost:3000/settings' };
    expect(isSafeNavigation(action, ['http://localhost:3000'], config)).toBe(true);
    for (const targetUrl of ['https://evil.test', 'javascript:alert(1)', 'http://localhost:3000/delete-account', 'http://localhost:3000/?token=secret', 'http://user:pass@localhost:3000']) expect(isSafeNavigation({ ...action, targetUrl }, ['http://localhost:3000'], config)).toBe(false);
    const control: NavigationAction = { kind: 'control', locator: { kind: 'role', role: 'button', name: 'Open menu' } };
    expect(isSafeNavigation(control, ['http://localhost:3000'], config)).toBe(false);
    expect(isSafeNavigation(control, ['http://localhost:3000'], { ...config, safeControls: [control.locator] })).toBe(true);
    expect(isSafeNavigation({ ...control, locator: { kind: 'role', role: 'button', name: 'Delete' } }, ['http://localhost:3000'], { ...config, safeControls: [{ kind: 'role', role: 'button', name: 'Delete' }] })).toBe(false);
  });
  it('finds weighted approved paths and excludes suspect/unapproved/cross-scope edges', () => {
    const graph = { scope: { id: 'scope' }, states: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], transitions: [
      { id: 'slow', scopeId: 'scope', fromStateId: 'a', toStateId: 'c', status: 'approved', failures: 20, successes: 1, verifiedAt: Date.now() },
      { id: 'ab', scopeId: 'scope', fromStateId: 'a', toStateId: 'b', status: 'approved', failures: 0, successes: 3, verifiedAt: Date.now() },
      { id: 'bc', scopeId: 'scope', fromStateId: 'b', toStateId: 'c', status: 'approved', failures: 0, successes: 3, verifiedAt: Date.now() },
      { id: 'unsafe', scopeId: 'other', fromStateId: 'a', toStateId: 'c', status: 'approved', failures: 0, successes: 3, verifiedAt: Date.now() }
    ] } as unknown as NavigationGraph;
    expect(findPath(graph, 'a', 'c').map(item => item.id)).toEqual(['ab', 'bc']);
    graph.transitions.forEach(edge => { edge.status = 'suspect'; }); expect(() => findPath(graph, 'a', 'c')).toThrow('No approved');
    expect(() => findPath(graph, 'missing', 'c')).toThrow();
  });
});
