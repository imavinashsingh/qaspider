import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
const requestSchema = z.object({ summary: z.string().trim().min(1).max(16000) }).strict();
const proposalSchema = z.object({ kind: z.literal('proposal'), source: z.string().min(1).max(100), synthetic: z.boolean(), summary: z.string().min(1).max(16000), items: z.array(z.string().min(1).max(4000)).max(100) }).strict();
export type ProviderContext = z.infer<typeof requestSchema>;
export type ProviderProposal = z.infer<typeof proposalSchema>;
export type ProviderOperation = 'plan' | 'interpret' | 'explore' | 'summarizeFailure';
export interface ProviderCapabilities { id: string; synthetic: boolean; operations: readonly ProviderOperation[]; applicationDataAllowed: boolean; }
export interface ProviderAdapter {
  capabilities(): ProviderCapabilities;
  plan(context: ProviderContext, signal?: AbortSignal): Promise<unknown>;
  interpret(context: ProviderContext, signal?: AbortSignal): Promise<unknown>;
  explore(context: ProviderContext, signal?: AbortSignal): Promise<unknown>;
  summarizeFailure(context: ProviderContext, signal?: AbortSignal): Promise<unknown>;
}
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Provider aborted'); }
export class FakeProvider implements ProviderAdapter {
  constructor(private readonly fixtures: Partial<Record<ProviderOperation, unknown>> = {}, private readonly options: { fail?: ProviderOperation; delayMs?: number } = {}) {}
  capabilities(): ProviderCapabilities { return { id: 'fake', synthetic: true, operations: ['plan', 'interpret', 'explore', 'summarizeFailure'], applicationDataAllowed: false }; }
  private async respond(operation: ProviderOperation, context: ProviderContext, signal?: AbortSignal): Promise<unknown> {
    requestSchema.parse(context); abort(signal);
    if (this.options.delayMs) { try { await delay(this.options.delayMs, undefined, { signal }); } catch { throw new Error('Provider aborted'); } }
    abort(signal);
    if (this.options.fail === operation) throw new Error('Fake provider failure');
    return structuredClone(this.fixtures[operation] ?? { kind: 'proposal', source: 'fake', synthetic: true, summary: `Synthetic ${operation}: ${context.summary}`, items: ['Fixture proposal only; no application execution'] });
  }
  plan(context: ProviderContext, signal?: AbortSignal) { return this.respond('plan', context, signal); }
  interpret(context: ProviderContext, signal?: AbortSignal) { return this.respond('interpret', context, signal); }
  explore(context: ProviderContext, signal?: AbortSignal) { return this.respond('explore', context, signal); }
  summarizeFailure(context: ProviderContext, signal?: AbortSignal) { return this.respond('summarizeFailure', context, signal); }
}
export class ValidatedProvider implements ProviderAdapter {
  constructor(private readonly adapter: ProviderAdapter) {}
  capabilities() { return this.adapter.capabilities(); }
  private async call(operation: ProviderOperation, context: ProviderContext, signal?: AbortSignal): Promise<ProviderProposal> {
    const request = requestSchema.parse(context); abort(signal);
    const capabilities = this.capabilities();
    if (!capabilities.operations.includes(operation)) throw new Error('Unsupported provider operation');
    const pending = this.adapter[operation](request, signal);
    let removeListener: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      if (signal) { const listener = () => reject(new Error('Provider aborted')); signal.addEventListener('abort', listener, { once: true }); removeListener = () => signal.removeEventListener('abort', listener); if (signal.aborted) listener(); }
    });
    try {
      const result = proposalSchema.parse(await Promise.race([pending, cancelled])); abort(signal);
      if (result.source !== capabilities.id || result.synthetic !== capabilities.synthetic) throw new Error('Provider provenance mismatch');
      return result;
    } finally { removeListener?.(); }
  }
  plan(context: ProviderContext, signal?: AbortSignal) { return this.call('plan', context, signal); }
  interpret(context: ProviderContext, signal?: AbortSignal) { return this.call('interpret', context, signal); }
  explore(context: ProviderContext, signal?: AbortSignal) { return this.call('explore', context, signal); }
  summarizeFailure(context: ProviderContext, signal?: AbortSignal) { return this.call('summarizeFailure', context, signal); }
}
