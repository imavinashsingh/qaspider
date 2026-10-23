import { z } from 'zod';
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const originSchema = z.string().refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === value; } catch { return false; }
}, 'Expected an exact HTTP(S) origin without credentials, path or trailing slash');
export const scopeSchema = z.object({ applicationId: idSchema, environmentId: idSchema, build: z.string().min(1), roleId: idSchema, tenant: z.string().min(1), featureFlags: z.record(z.string(), z.boolean()) }).strict();
export type Scope = z.infer<typeof scopeSchema>;
const envRef = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
export const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guest') }).strict(),
  z.object({ kind: z.literal('form'), usernameEnv: envRef, passwordEnv: envRef }).strict(),
  z.object({ kind: z.literal('storage-state'), storageStateEnv: envRef }).strict()
]);
export const applicationSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(200) }).strict();
export const environmentSchema = z.object({ id: idSchema, applicationId: idSchema, name: z.string().trim().min(1), kind: z.enum(['development', 'qa', 'production']), allowedOrigins: z.array(originSchema).min(1) }).strict();
export const roleSchema = z.object({ id: idSchema, environmentId: idSchema, name: z.string().trim().min(1), auth: authSchema }).strict();
export const settingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
  globalQuotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  perRunQuotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  captureFullTraces: z.boolean()
}).strict().refine(s => s.perRunQuotaBytes <= s.globalQuotaBytes, 'Per-run quota exceeds global quota');
export const defaultSettings = Object.freeze({ retentionDays: 14, globalQuotaBytes: 10 * 1024 ** 3, perRunQuotaBytes: 1024 ** 3, captureFullTraces: true });
export type Application = z.infer<typeof applicationSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type RoleProfile = z.infer<typeof roleSchema>;
export type WorkspaceSettings = z.infer<typeof settingsSchema>;
export const approvalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigation-batch'), scope: scopeSchema, candidateIds: z.array(idSchema).min(1).refine(ids => new Set(ids).size === ids.length), approvedBy: z.string().min(1) }).strict(),
  ...(['business-rule', 'security-expectation'] as const).map(kind => z.object({ kind: z.literal(kind), scope: scopeSchema, candidateId: idSchema, approvedBy: z.string().min(1), authoritativeSource: z.string().min(1) }).strict())
]);
export type Approval = z.infer<typeof approvalSchema>;
export interface ApplicationRepository { createApplication(input: Application): Application; getApplication(id: string): Application | undefined; }
export interface EnvironmentRepository { createEnvironment(input: Environment): Environment; getEnvironment(id: string): Environment | undefined; }
export interface RoleRepository { createRole(input: RoleProfile): RoleProfile; getRole(id: string): RoleProfile | undefined; }
export interface SettingsRepository { getSettings(): WorkspaceSettings; setSettings(input: WorkspaceSettings): void; }
export interface WorkspaceRepository extends ApplicationRepository, EnvironmentRepository, RoleRepository, SettingsRepository {
  transaction<T>(operation: () => T): T;
  close(): void;
}
export const artifactKindSchema = z.enum(['trace', 'screenshot', 'event-log']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export interface ArtifactRecord {
  id: string; runId: string; kind: ArtifactKind; sizeBytes: number; createdAt: number; expiresAt: number;
  active: boolean; status: 'available' | 'expired' | 'deleted';
}
export interface ArtifactRepository { getArtifact(id: string): ArtifactRecord | undefined; listArtifacts(): ArtifactRecord[]; }
export interface ArtifactStorage { put(runId: string, data: Uint8Array, kind: ArtifactKind): ArtifactRecord; read(id: string): Buffer; finishRun(runId: string): void; delete(id: string): void; prune(): number; }
