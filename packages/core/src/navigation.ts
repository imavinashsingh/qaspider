import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scopeSchema, type Scope } from './contracts.js';
export const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('testId'), value: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('label'), value: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('role'), role: z.enum(['link', 'button', 'tab', 'heading', 'dialog', 'textbox', 'alert', 'status']), name: z.string().max(200) }).strict()
]);
export type LocatorSpec = z.infer<typeof locatorSchema>;
const sensitiveKey = /password|secret|token|session|auth|cookie|credential|key|email/i;
export const httpUrlSchema = z.string().url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && ![...url.searchParams.keys()].some(key => sensitiveKey.test(key)); }, 'Unsafe URL');
export const navigationConfigSchema = z.object({
  relevantQueryKeys: z.array(z.string().regex(/^[a-zA-Z_][\w-]*$/).refine(value => !sensitiveKey.test(value))).default([]),
  volatileQueryKeys: z.array(z.string()).default(['timestamp', 'cacheBust', '_']),
  volatileSelectors: z.array(z.string().min(1).max(200)).max(20).default([]),
  privateSelectors: z.array(z.string().min(1).max(200)).max(20).default([]),
  safeControls: z.array(locatorSchema).max(30).default([]),
  auth: z.object({ url: httpUrlSchema, submitUrl: httpUrlSchema, username: locatorSchema, password: locatorSchema, submit: locatorSchema, ready: locatorSchema, tenantReady: locatorSchema.optional() }).strict().optional()
}).strict();
export type NavigationConfig = z.infer<typeof navigationConfigSchema>;
export const navigationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), locator: locatorSchema, targetUrl: httpUrlSchema }).strict(),
  z.object({ kind: z.literal('control'), locator: locatorSchema }).strict()
]);
export type NavigationAction = z.infer<typeof navigationActionSchema>;
export const budgetsSchema = z.object({ depth: z.number().int().min(0).max(20).default(3), maxStates: z.number().int().min(1).max(1000).default(100), maxActions: z.number().int().min(1).max(10000).default(300), maxRequests: z.number().int().min(1).max(100000).default(3000), maxMs: z.number().int().min(100).max(3600000).default(600000), actionTimeoutMs: z.number().int().min(100).max(60000).default(10000), intervalMs: z.number().int().min(0).max(60000).default(1000) }).strict();
export type NavigationBudgets = z.infer<typeof budgetsSchema>;
export interface Control { role: string; name: string; testId: string | null; href: string | null; expanded: boolean | null; selected: boolean | null; disabled?: boolean; checked?: boolean; }
export interface Observation { url: string; headings: string[]; controls: Control[]; dialogs: string[]; }
export interface NormalizedObservation extends Observation { fingerprint: string; normalizationVersion: 1; }
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function scopeId(scope: Scope): string { const parsed = scopeSchema.parse(scope); return hash({ ...parsed, featureFlags: Object.fromEntries(Object.entries(parsed.featureFlags).sort(([a], [b]) => a.localeCompare(b))) }); }
export function redact(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[redacted]');
  return result.replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email]').replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '[timestamp]').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]').replace(/\s+/g, ' ').trim().slice(0, 500);
}
export function normalizeUrl(value: string, config: NavigationConfig, secrets: string[] = []): string {
  const url = new URL(value); url.username = ''; url.password = ''; url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (!config.relevantQueryKeys.includes(key) || sensitiveKey.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return redact(url.toString(), secrets);
}
export function normalizeObservation(input: Observation, config: NavigationConfig, secrets: string[] = []): NormalizedObservation {
  const normalized: Observation = {
    url: normalizeUrl(input.url, config, secrets), headings: input.headings.map(text => redact(text, secrets)), dialogs: input.dialogs.map(text => redact(text, secrets)),
    controls: input.controls.map(control => ({ role: control.role, name: redact(control.name, secrets), testId: control.testId ? redact(control.testId, secrets) : null, href: control.href ? normalizeUrl(control.href, config, secrets) : null, expanded: control.expanded, selected: control.selected, disabled: control.disabled ?? false, checked: control.checked ?? false })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  };
  return { ...normalized, normalizationVersion: 1, fingerprint: hash({ normalizationVersion: 1, ...normalized }) };
}
const risky = /(?:^|[\s/_?=&.-])(delete|remove|logout|log-out|sign-out|signout|purchase|checkout|buy|pay|send|invite|submit|create|destroy|revoke|disable|enable|reset|transfer|approve|reject|unsubscribe)(?:$|[\s/_?=&.-])/i;
export function isSafeNavigation(input: NavigationAction, origins: string[], config: NavigationConfig): boolean {
  const parsed = navigationActionSchema.safeParse(input); if (!parsed.success) return false;
  const action = parsed.data; const text = action.locator.kind === 'role' ? action.locator.name : action.locator.value;
  if (risky.test(text) || redact(text) !== text) return false;
  if (action.kind === 'control') return config.safeControls.some(locator => JSON.stringify(locator) === JSON.stringify(action.locator)) && (action.locator.kind === 'testId' || (action.locator.kind === 'role' && ['button', 'tab'].includes(action.locator.role)));
  const url = new URL(action.targetUrl);
  try { return origins.includes(url.origin) && !risky.test(decodeURIComponent(url.pathname + url.search)) && [...url.searchParams.keys()].every(key => config.relevantQueryKeys.includes(key) || config.volatileQueryKeys.includes(key)); } catch { return false; }
}
export interface NavigationScope { id: string; scope: Scope; seedUrl: string; config: NavigationConfig; }
export interface UILocation { id: string; scopeId: string; url: string; }
export interface UIState { id: string; scopeId: string; locationId: string; observation: NormalizedObservation; evidenceId: string; observedAt: number; }
export interface StateCondition { url: string; fingerprint: string; headings: string[]; }
export interface Transition { id: string; scopeId: string; fromStateId: string; toStateId: string; action: NavigationAction; precondition: StateCondition; postcondition: StateCondition; status: 'candidate' | 'verified' | 'approved' | 'suspect'; successes: number; failures: number; verifiedAt: number | null; evidenceId: string | null; }
export interface NavigationApproval { id: string; scopeId: string; transitionIds: string[]; approvedBy: string; approvedAt: number; }
export interface NavigationRun { id: string; scopeId: string; kind: 'map' | 'replay'; status: 'running' | 'complete' | 'budget-exhausted' | 'cancelled' | 'blocked' | 'failed'; startedAt: number; finishedAt: number | null; actions: number; requests: number; states: number; message: string; evidenceIds: string[]; }
export interface NavigationGraph { scope: NavigationScope | null; locations: UILocation[]; states: UIState[]; transitions: Transition[]; approvals: NavigationApproval[]; runs: NavigationRun[]; }
export interface NavigationRepository {
  ensureScope(scope: Scope, seedUrl: string, config: NavigationConfig): NavigationScope;
  listScopes(): NavigationScope[];
  snapshot(scope: Scope): NavigationGraph;
  saveState(scope: Scope, observation: NormalizedObservation, evidenceId: string): UIState;
  saveTransition(scope: Scope, fromStateId: string, toStateId: string, action: NavigationAction): Transition;
  startRun(scope: Scope, kind: 'map' | 'replay'): NavigationRun;
  finishRun(id: string, result: Pick<NavigationRun, 'status' | 'actions' | 'requests' | 'states' | 'message' | 'evidenceIds'>): NavigationRun;
  recordVerification(scope: Scope, transitionId: string, runId: string, evidenceId: string, passed: boolean): void;
  approveBatch(scope: Scope, transitionIds: string[], approvedBy: string): NavigationApproval;
}
export function findPath(graph: NavigationGraph, from: string, to: string, now = Date.now()): Transition[] {
  if (!graph.scope || !graph.states.some(state => state.id === from) || !graph.states.some(state => state.id === to)) throw new Error('Unknown scoped path endpoint');
  const costs = new Map<string, number>([[from, 0]]); const paths = new Map<string, Transition[]>([[from, []]]); const visited = new Set<string>();
  while (costs.size) {
    const current = [...costs].filter(([id]) => !visited.has(id)).sort((a, b) => a[1] - b[1])[0]; if (!current) break;
    const [id, cost] = current; if (id === to) return paths.get(id)!; visited.add(id);
    for (const edge of graph.transitions.filter(edge => edge.scopeId === graph.scope!.id && edge.fromStateId === id && edge.status === 'approved')) {
      const weight = 1 + 10 * edge.failures / Math.max(1, edge.successes) + Math.min(5, Math.max(0, now - (edge.verifiedAt ?? 0)) / 86400000 / 30);
      if (cost + weight < (costs.get(edge.toStateId) ?? Infinity)) { costs.set(edge.toStateId, cost + weight); paths.set(edge.toStateId, [...paths.get(id)!, edge]); }
    }
  }
  throw new Error('No approved scoped path');
}
