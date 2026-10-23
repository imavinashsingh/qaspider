import { z } from 'zod';
import { originSchema } from './contracts.js';
const kinds = z.enum(['navigate', 'read', 'fixture-write', 'submit', 'delete', 'purchase', 'message', 'invite', 'privileged-change']);
const policySchema = z.object({ allowedOrigins: z.array(originSchema), environment: z.enum(['development', 'qa', 'production']), allowProductionWrites: z.boolean().default(false) }).strict();
const actionSchema = z.object({ url: z.string(), kind: kinds }).strict();
const grantSchema = z.object({ origin: originSchema, kind: kinds }).strict();
export type Policy = z.input<typeof policySchema>;
export type Action = z.infer<typeof actionSchema>;
export type ActionPermission = z.infer<typeof grantSchema>;
export function evaluateAction(policy: Policy, action: Action, permissions: ActionPermission[] = []): { allowed: boolean; reason: string } {
  const config = policySchema.safeParse(policy); const parsed = actionSchema.safeParse(action);
  if (!config.success || !parsed.success) return { allowed: false, reason: 'Invalid policy or unclassified action' };
  let origin: string;
  try {
    const url = new URL(parsed.data.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe URL');
    origin = url.origin;
  } catch { return { allowed: false, reason: 'Invalid or unsafe URL' }; }
  if (!config.data.allowedOrigins.includes(origin)) return { allowed: false, reason: 'Origin is not declared' };
  if (['navigate', 'read'].includes(parsed.data.kind)) return { allowed: true, reason: 'Declared safe navigation/read' };
  if (config.data.environment === 'production') return { allowed: false, reason: 'Production writes are locked off in M0' };
  const permitted = permissions.some(value => { const grant = grantSchema.safeParse(value); return grant.success && grant.data.origin === origin && grant.data.kind === parsed.data.kind; });
  return { allowed: permitted, reason: permitted ? 'Explicit action permission' : 'Explicit action permission required' };
}
