import { expect, it } from 'vitest';
import { isolationArgs, validateWireRequest, validateEvents } from '../../packages/providers/src/codex.js';
it('uses noninteractive read-only tool-free settings without shell interpolation', () => {
    const args = isolationArgs('/tmp/schema.json');
    expect(args).toContain('--strict-config');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(args).toContain('read-only');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('features.hooks=false');
    expect(args).toContain('features.apps=false');
    expect(() => validateWireRequest({ tools: [{ type: 'function', name: 'exec_command' }], input: [] })).toThrow();
    expect(validateWireRequest({ tools: [], input: [{ role: 'user', content: 'synthetic' }] }).tools).toEqual([]);
    expect(() => validateEvents([{ type: 'item.started', item: { type: 'command_execution' } }])).toThrow();
});
it('converts only the wire schema while retaining strict validation and a minimal child environment', async () => {
    const { codexOutputSchema, providerEnvironment } = await import('../../packages/providers/src/codex.js');
    const serialized = JSON.stringify(codexOutputSchema());
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized).toContain('"anyOf"');
    expect(serialized).toContain('"additionalProperties":false');
    const env = providerEnvironment('/tmp/private-provider-home');
    expect(Object.keys(env).sort()).toEqual(['CODEX_HOME', 'HOME', 'LANG', 'PATH']);
    expect(env.CODEX_HOME).toBe('/tmp/private-provider-home');
    expect(() => validateEvents([{ type: 'item.completed', item: { type: 'mcp_tool_call' } }])).toThrow();
});
