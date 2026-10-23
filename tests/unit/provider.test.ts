import { describe, expect, it } from 'vitest';
import { FakeProvider, ValidatedProvider, type ProviderAdapter } from '../../packages/core/src/provider.js';
const context = { summary: 'Registration criteria supplied by the user' };
describe('provider boundary', () => {
  it('labels fake output and returns deterministic proposals for all operations', async () => {
    const provider = new ValidatedProvider(new FakeProvider());
    expect(provider.capabilities()).toMatchObject({ id: 'fake', synthetic: true });
    for (const operation of ['plan', 'interpret', 'explore', 'summarizeFailure'] as const) {
      const first = await provider[operation](context);
      expect(first).toEqual(await provider[operation](context));
      expect(first).toMatchObject({ kind: 'proposal', source: 'fake', synthetic: true });
    }
  });
  it('rejects executable/unknown fields and malformed provider results', async () => {
    const fake = new FakeProvider({ plan: { kind: 'proposal', source: 'fake', synthetic: true, summary: 'bad', items: [], javascript: 'fetch()' } });
    await expect(new ValidatedProvider(fake).plan(context)).rejects.toThrow();
    await expect(new ValidatedProvider(new FakeProvider({ plan: {} })).plan(context)).rejects.toThrow();
  });
  it('supports fixture output, controlled errors and pre/in-flight cancellation', async () => {
    const fixture = { kind: 'proposal', source: 'fake', synthetic: true, summary: 'fixture', items: ['case'] };
    expect(await new ValidatedProvider(new FakeProvider({ plan: fixture })).plan(context)).toEqual(fixture);
    await expect(new FakeProvider({}, { fail: 'interpret' }).interpret(context)).rejects.toThrow('Fake provider failure');
    const controller = new AbortController();
    const pending = new FakeProvider({}, { delayMs: 10000 }).plan(context, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    await expect(new FakeProvider().plan(context, controller.signal)).rejects.toThrow('aborted');
  });
  it('validates input and cancellation even for an uncooperative adapter', async () => {
    const fake = new FakeProvider();
    const adapter: ProviderAdapter = { ...fake, capabilities: () => fake.capabilities(), plan: async () => ({ invalid: true }), interpret: fake.interpret.bind(fake), explore: fake.explore.bind(fake), summarizeFailure: fake.summarizeFailure.bind(fake) };
    await expect(new ValidatedProvider(adapter).plan({ summary: '', rawTrace: 'secret' } as never)).rejects.toThrow();
  });
});
it('rejects cancellation while an adapter ignores its signal and rejects forged provenance', async () => {
  const fake = new FakeProvider();
  const adapter: ProviderAdapter = {
    capabilities: () => fake.capabilities(), plan: () => new Promise(() => {}),
    interpret: fake.interpret.bind(fake), explore: fake.explore.bind(fake), summarizeFailure: fake.summarizeFailure.bind(fake)
  };
  const controller = new AbortController(); const pending = new ValidatedProvider(adapter).plan(context, controller.signal);
  controller.abort(); await expect(pending).rejects.toThrow('aborted');
  await expect(new ValidatedProvider(new FakeProvider({ plan: { kind: 'proposal', source: 'real-provider', synthetic: false, summary: 'forged', items: [] } })).plan(context)).rejects.toThrow('provenance');
});
