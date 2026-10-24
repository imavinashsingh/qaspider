import { z } from 'zod';
import { idSchema, scopeSchema, type Scope } from './contracts.js';
import { httpUrlSchema, locatorSchema, type LocatorSpec } from './navigation.js';
export const outcomeSchema = z.enum(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE', 'FLAKY', 'NOT RUN']);
export type Outcome = z.infer<typeof outcomeSchema>;
export const storyContextSchema = scopeSchema.omit({ roleId: true }).extend({ roleIds: z.array(idSchema).min(1).max(12).refine(ids => new Set(ids).size === ids.length) }).strict();
export type StoryContext = z.infer<typeof storyContextSchema>;
export const grantSchema = z.object({ roleId: idSchema, url: httpUrlSchema, method: z.literal('POST') }).strict();
export const policySchema = z.object({ actionGrants: z.array(grantSchema).max(50), readGrants: z.array(z.object({ roleId: idSchema, url: httpUrlSchema }).strict()).max(50), fixtures: z.object({ setupUrl: httpUrlSchema, cleanupUrl: httpUrlSchema, tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/), emailDomain: z.string().regex(/^[a-z0-9.-]+\.(test|invalid)$/) }).strict().nullable(), discovery: z.boolean() }).strict();
export type TestPolicy = z.infer<typeof policySchema>;
export const inputSchema = z.object({ key: idSchema, type: z.enum(['text', 'email', 'password']), source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('literal'), value: z.string().max(256) }).strict(),
        z.object({ kind: z.literal('unique-email') }).strict(), z.object({ kind: z.literal('duplicate-email') }).strict(), z.object({ kind: z.literal('generated-password') }).strict()
    ]) }).strict().refine(item => item.type !== 'password' || item.source.kind === 'generated-password', 'Passwords must be generated, never persisted literals').refine(item => item.source.kind !== 'literal' || !/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/.test(item.source.value), 'Valid email inputs must be owned fixtures');
export const stepSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fill'), locator: locatorSchema, valueKey: idSchema }).strict(),
    z.object({ kind: z.literal('click'), locator: locatorSchema, submitUrl: httpUrlSchema.nullable() }).strict()
]);
export const assertionSchema = z.discriminatedUnion('kind', [
    z.object({ id: idSchema, requirementId: idSchema, kind: z.literal('text'), locator: locatorSchema, expected: z.string().min(1).max(1000), comparison: z.enum(['equals', 'contains']) }).strict(),
    z.object({ id: idSchema, requirementId: idSchema, kind: z.literal('visible'), locator: locatorSchema, expected: z.boolean() }).strict(),
    z.object({ id: idSchema, requirementId: idSchema, kind: z.literal('http-status'), url: httpUrlSchema, expected: z.number().int().min(100).max(599) }).strict()
]);
export const scenarioSchema = z.object({ id: idSchema, title: z.string().min(1).max(200), roleId: idSchema, requirementIds: z.array(idSchema).min(1), targetStateId: idSchema, data: z.array(inputSchema).max(20), steps: z.array(stepSchema).max(40), assertions: z.array(assertionSchema).min(1).max(30), allowedActions: z.array(grantSchema).max(10), cleanup: z.literal('owned-fixtures'), severity: z.enum(['low', 'medium', 'high', 'critical']), retries: z.number().int().min(0).max(1) }).strict().superRefine((scenario, ctx) => {
    if (new Set(scenario.assertions.map(a => a.id)).size !== scenario.assertions.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate assertion IDs' });
    const keys = scenario.data.map(value => value.key);
    if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate input keys' });
    for (const step of scenario.steps)
        if (step.kind === 'fill' && !keys.includes(step.valueKey))
            ctx.addIssue({ code: 'custom', message: 'Unknown input reference' });
    for (const assertion of scenario.assertions)
        if (!scenario.requirementIds.includes(assertion.requirementId))
            ctx.addIssue({ code: 'custom', message: 'Assertion lacks cited requirement' });
});
export const proposalSchema = z.object({ title: z.string().min(1).max(200), feature: z.string().min(1).max(200), inferredRequirements: z.array(z.object({ text: z.string().min(1).max(1000) }).strict()).max(20), scenarios: z.array(scenarioSchema).min(1).max(48) }).strict().refine(value => new Set(value.scenarios.map(s => s.id)).size === value.scenarios.length, 'Duplicate scenario IDs');
export type Scenario = z.infer<typeof scenarioSchema>;
export type PlanProposal = z.infer<typeof proposalSchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export interface Requirement {
    id: string;
    key: string;
    text: string;
    sourceRef: string;
    origin: 'specified' | 'ai-inferred';
    approved: boolean;
}
export interface StoryRevision {
    id: string;
    storyId: string;
    revision: number;
    title: string;
    markdown: string;
    sourceRef: string;
    context: StoryContext;
    requirements: Requirement[];
}
export interface PlanRevision {
    id: string;
    planId: string;
    revision: number;
    storyRevisionId: string;
    proposal: PlanProposal;
    policy: TestPolicy;
    hash: string;
    status: 'draft' | 'approved';
    provider: {
        id: string;
        synthetic: boolean;
        validationId: string | null;
    };
    createdAt: number;
}
export const providerMetadataSchema = z.object({ id: z.string().min(1).max(100), synthetic: z.boolean(), validationId: z.string().nullable() }).strict().refine(value => value.synthetic || !!value.validationId, 'Real providers require isolation validation provenance');
export interface AssertionResult {
    id: string;
    requirementId: string;
    status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
    expected: unknown;
    actual: unknown;
    evidenceId: string;
}
export interface AttemptResult {
    status: Outcome;
    reason: string;
    assertions: AssertionResult[];
    evidenceIds: string[];
    navigationRunId: string | null;
}
export interface TestRun {
    id: string;
    planRevisionId: string;
    status: 'running' | 'complete' | 'cancelled' | 'interrupted';
    startedAt: number;
    finishedAt: number | null;
    selectedScenarioIds: string[];
}
export interface ScenarioResult {
    scenarioId: string;
    roleId: string;
    status: Outcome;
    attempts: AttemptResult[];
}
export interface TestReport {
    run: TestRun;
    plan: PlanRevision;
    story: StoryRevision;
    results: ScenarioResult[];
    fixtures: FixtureReservation[];
    summary: Record<Outcome, number>;
}
export interface FixtureReservation {
    id: string;
    runId: string;
    scenarioId: string;
    attempt: number;
    kind: 'unique-email' | 'duplicate-email';
    status: 'reserved' | 'created' | 'cleaned' | 'orphan';
    message: string;
}
export interface QaJob {
    id: string;
    kind: 'plan' | 'execute';
    status: 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
    referenceId: string;
    resultId: string | null;
    message: string;
}
export interface TestingRepository {
    saveProposedPlan(storyId:string,proposal:PlanProposal,policy:TestPolicy,provider:PlanRevision['provider'],planId?:string):PlanRevision;
    permissions(id:string):import('./permissions.js').ExecutionAuthorization;
    decidePermissions(id:string,hash:string,decisions:import('./permissions.js').PermissionDecisionInput[],reviewer:string):import('./permissions.js').ExecutionAuthorization;
    configureAccess(id:string,policy:TestPolicy):PlanRevision;
    assertAuthorized(id:string,scenarioId:string):void;
    executionPolicy(id:string,scenarioId:string):TestPolicy;
    importStory(markdown: string, sourceRef: string, context: StoryContext, storyId?: string): StoryRevision;
    getStory(id: string): StoryRevision | undefined;
    listStories(): StoryRevision[];
    addInference(storyRevisionId: string, text: string, provider: string): Requirement;
    savePlan(storyRevisionId: string, proposal: PlanProposal, policy: TestPolicy, provider: PlanRevision['provider'], planId?: string): PlanRevision;
    revisePlan(baseId: string, proposal: PlanProposal): PlanRevision;
    getPlan(id: string): PlanRevision | undefined;
    listPlans(): PlanRevision[];
    approvePlan(id: string, reviewer: string, requirementIds: string[]): PlanRevision;
    startRun(planRevisionId: string, selected?: string[]): TestRun;
    recordAttempt(runId: string, scenarioId: string, attempt: number, result: AttemptResult): void;
    finishRun(id: string, status: TestRun['status']): void;
    report(id: string): TestReport | undefined;
    listRuns(): TestRun[];
    reserveFixture(runId: string, scenarioId: string, attempt: number, kind: FixtureReservation['kind']): FixtureReservation;
    updateFixture(id: string, status: FixtureReservation['status'], message?: string): void;
    createJob(kind: QaJob['kind'], referenceId: string): QaJob;
    updateJob(id: string, status: QaJob['status'], message: string, resultId?: string): void;
    getJob(id: string): QaJob | undefined;
}
export function parseStory(markdown: string, sourceRef: string) {
    z.string().min(1).max(100000).parse(markdown);
    z.string().min(1).max(500).parse(sourceRef);
    const lines = markdown.split(/\r?\n/);
    const title = lines.find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim();
    if (!title)
        throw new Error('Story requires a Markdown title');
    const start = lines.findIndex(line => /^#{1,4}\s+Acceptance Criteria\s*$/i.test(line));
    if (start < 0)
        throw new Error('Story requires Acceptance Criteria');
    const requirements: Array<{
        key: string;
        text: string;
        sourceRef: string;
        origin: 'specified';
    }> = [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (/^#{1,4}\s/.test(line))
            break;
        const match = /^\s*(?:[-*]|\d+[.)])\s+(?:\[?(AC-[\w-]+)\]?:?\s*)?(.+)$/.exec(line);
        if (match)
            requirements.push({ key: match[1] ?? `AC-${requirements.length + 1}`, text: match[2]!.trim(), sourceRef: `${sourceRef}#L${i + 1}`, origin: 'specified' });
    }
    if (!requirements.length || requirements.length > 40 || new Set(requirements.map(r => r.key)).size !== requirements.length)
        throw new Error('Expected 1–40 uniquely identified acceptance criteria');
    return { title, requirements };
}
export function scenarioScope(context: StoryContext, scenario: Pick<Scenario, 'roleId'>): Scope {
    const { roleIds, ...scope } = context;
    if (!roleIds.includes(scenario.roleId))
        throw new Error('Scenario role is outside story scope');
    return { ...scope, roleId: scenario.roleId };
}
export function classifyAttempts(statuses: Outcome[]): Outcome {
    if (!statuses.length)
        return 'NOT RUN';
    if (statuses.includes('BLOCKED'))
        return 'BLOCKED';
    if (statuses.includes('INCONCLUSIVE') || statuses.includes('NOT RUN'))
        return 'INCONCLUSIVE';
    if (new Set(statuses).size > 1)
        return 'FLAKY';
    return statuses[0]!;
}
export function resolveLocator(page: import('playwright').Page, spec: LocatorSpec) { return spec.kind === 'testId' ? page.getByTestId(spec.value) : spec.kind === 'label' ? page.getByLabel(spec.value, { exact: true }) : page.getByRole(spec.role, { name: spec.name, exact: true }); }
