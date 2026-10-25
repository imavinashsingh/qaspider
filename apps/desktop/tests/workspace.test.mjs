import { describe, expect, it, vi } from 'vitest';
import { classifyClick, validateAssertion } from '../electron/action-policy.mjs';
import { TestingWorkspace } from '../electron/workspace.mjs';
import { CodexProvider } from '../electron/codex-provider.mjs';

const action = { selector: '#save', description: 'Save demo', method: 'click', arguments: [] };
const element = { tag: 'BUTTON', visible: true, enabled: true, inForm: false, download: false, target: '' };
describe('M2 action policy', () => {
  it('requires explicit authorization for an ordinary button', () => expect(classifyClick(action, element, 'http://localhost:3000')).toMatchObject({ allowed: true, requiresAuthorization: true }));
  it.each([
    { ...element, tag: 'INPUT' }, { ...element, inForm: true }, { ...element, download: true },
    { ...element, target: '_blank' }, { ...element, enabled: false }, { ...element, visible: false },
    { ...element, tag: 'A', href: 'https://other.example/' }, { ...element, tag: 'A', href: 'javascript:alert(1)' },
  ])('rejects unsupported or unsafe elements', value => expect(classifyClick(action, value, 'http://localhost:3000').allowed).toBe(false));
  it('rejects arbitrary action methods', () => expect(classifyClick({ ...action, method: 'evaluate' }, element, 'http://localhost:3000').allowed).toBe(false));
  it('rejects cross-origin assertions and executable assertion payloads', () => {
    expect(() => validateAssertion({ kind: 'url', expected: 'https://outside.example/' }, 'http://localhost:3000')).toThrow();
    expect(() => validateAssertion({ kind: 'script', expression: 'return true' }, 'http://localhost:3000')).toThrow();
  });
});
describe('M2 provider and lifecycle failures', () => {
  it('distinguishes navigation failures from an unavailable AI provider', async () => {
    const workspace = new TestingWorkspace({ provider: { prepare: async () => ({}) }, openSession: async () => { throw new Error('navigation: Could not load http://localhost:3000 (net::ERR_CONNECTION_REFUSED). Start the development application.'); } });
    const result = await workspace.observe({ url: 'http://localhost:3000', instruction: 'Find buttons' });
    expect(result.status).toBe('error');
    expect(result.message).toContain('Observation could not start: navigation:');
    expect(result.message).not.toContain('AI observation unavailable');
  });
  it('defers invalid model configuration to observation so plain capture can still launch', async () => {
    const provider = new CodexProvider({ model: 'invalid model name' });
    await expect(provider.prepare()).rejects.toThrow('invalid Codex model configuration');
  });
  it('reports unavailable without a provider and does not open Chromium', async () => {
    const openSession = vi.fn();
    const workspace = new TestingWorkspace({ openSession });
    expect(await workspace.observe({ url: 'http://localhost:3000', instruction: 'Find buttons' })).toMatchObject({ status: 'unavailable', outcome: 'INCONCLUSIVE', message: expect.stringContaining('no compatible model') });
    expect(openSession).not.toHaveBeenCalled();
  });
  it('cleans up after observation failure', async () => {
    const close = vi.fn();
    const session = { close, stagehand: { observe: async () => { throw new Error('Provider offline'); } }, page: { url: async () => 'http://localhost:3000/' }, screenshot: async () => 'data:image/png;base64,cG5n' };
    const workspace = new TestingWorkspace({ provider: { prepare: async () => ({}), generate: vi.fn() }, openSession: async () => session });
    expect((await workspace.observe({ url: 'http://localhost:3000', instruction: 'Find buttons' })).message).toContain('Provider offline');
    expect(close).toHaveBeenCalledOnce();
  });
  it('rejects invented action IDs and extra natural language payloads', async () => {
    const workspace = new TestingWorkspace();
    expect((await workspace.execute({ observationId: 'bad', actionId: 'fake', authorized: true, instruction: 'Click anything' })).outcome).toBe('BLOCKED');
  });
  it('does not silently drop images or tool requests', async () => {
    const provider = new CodexProvider();
    await expect(provider.generate({ responseFormat: { type: 'json_schema', schema: {} }, messages: [{ content: { type: 'image', data: 'test' } }] })).rejects.toThrow('does not support');
    await expect(provider.generate({ responseFormat: { type: 'text' } })).rejects.toThrow('structured text');
  });
});
