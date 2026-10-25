import { describe, it, expect } from 'vitest';
import { cliUsage } from '../electron/codex-provider.mjs';
import { operationKey } from '../electron/knowledge.mjs';
import { plan, navigate, fill, click, check } from './fixtures/generic-plan.mjs';
describe('M6 usage and workflow identity', () => {
  it('uses actual CLI counters, includes cached input once and selects the final turn', () => {
    expect(cliUsage('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3,"cached_input_tokens":5}}')).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15, cachedInputTokens: 5 });
    expect(cliUsage('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n{"type":"turn.completed","usage":{"input_tokens":20,"output_tokens":4}}').totalTokens).toBe(24);
  });
  it('does not invent usage for missing or malformed counters', () => {
    for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 4 }, { input_tokens: '12', output_tokens: 3 }]) expect(cliUsage(JSON.stringify({ type: 'turn.completed', usage }))).toBeUndefined();
  });
  it('ignores ticket names and fill literals but requires exact ordered operations and assertions', () => {
    const make = value => plan([navigate('/contact'), fill('Email', value), click('Submit'), check('Message received')]);
    expect(operationKey(make('one@example.test'))).toBe(operationKey({ ...make('two@example.test'), id: 'different-ticket', name: 'different title' }));
    expect(operationKey(make('one@example.test'))).not.toBe(operationKey(plan([navigate('/contact'), click('Submit'), check('Message received')])));
    const changed = make('one@example.test'); changed.steps.at(-1).assertion.expected = 'Unexpected';
    expect(operationKey(make('one@example.test'))).not.toBe(operationKey(changed));
  });
});
