import type { Browser } from 'playwright';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { CodexPlanningAdapter } from '../../providers/src/codex.js';
import { NavigationEngine } from '../../navigation/src/engine.js';
import { TestExecutor } from './execution.js';
import { policySchema, proposalSchema, findPath, scenarioScope, type TestPolicy, type ProviderAdapter, type QaJob, type PlanRevision } from '../../core/src/index.js';
export class QaService {
    private readonly pending = new Map<string, {
        controller: AbortController;
        promise: Promise<void>;
    }>();
    constructor(readonly store: SqliteStore, readonly artifacts: ArtifactStore, private readonly provider: ProviderAdapter | (()=>ProviderAdapter) = new CodexPlanningAdapter(), private readonly browser?: Browser, private readonly env: NodeJS.ProcessEnv = process.env) { }
    async plan(storyId: string, policyInput: TestPolicy, signal?: AbortSignal): Promise<PlanRevision> {
        const provider=typeof this.provider==='function'?this.provider():this.provider;
        const story = this.store.testing.getStory(storyId);
        if (!story)
            throw new Error('Unknown story revision');
        const policy = policySchema.parse(policyInput);
        const environment = this.store.getEnvironment(story.context.environmentId);
        if (!environment || environment.kind === 'production')
            throw new Error('Planning requires development or QA');
        for (const grant of [...policy.actionGrants, ...policy.readGrants])
            if (!story.context.roleIds.includes(grant.roleId) || !environment.allowedOrigins.includes(new URL(grant.url).origin))
                throw new Error('Policy grant outside story scope');
        if (policy.fixtures && ![policy.fixtures.setupUrl, policy.fixtures.cleanupUrl].every(url => environment.allowedOrigins.includes(new URL(url).origin)))
            throw new Error('Fixture endpoint outside story scope');
        // No context reaches a real provider until its own synthetic capability gate passes.
        if (!provider.capabilities().synthetic) {
            if (!(this.provider instanceof CodexPlanningAdapter))
                throw new Error('Unvalidated real provider');
            await this.provider.validateIsolation(signal);
        }
        const terms = [...new Set(story.title.toLowerCase().split(/\W+/).filter(term => term.length > 3 && !['story', 'test', 'user', 'with', 'should'].includes(term)).flatMap(term => term === 'registration' ? ['registration', 'register'] : [term]))].slice(0, 12);
        const navigation = [];
        for (const roleId of story.context.roleIds) {
            const scope = scenarioScope(story.context, { roleId });
            let graph = this.store.navigation.snapshot(scope);
            if (policy.discovery && graph.scope && !graph.states.some(state => terms.some(term => (state.observation.headings.join(' ') + ' ' + state.observation.dialogs.join(' ') + ' ' + state.observation.url).toLowerCase().includes(term)))) {
                await new NavigationEngine(this.store, this.artifacts, this.browser).map(scope, graph.scope.seedUrl, graph.scope.config, { depth: 2, maxStates: 12, maxActions: 60, maxRequests: 200, maxMs: 30000, intervalMs: 100 }, signal, this.env, terms);
                graph = this.store.navigation.snapshot(scope);
            }
            if (!graph.scope)
                throw new Error('Map this exact role/environment/tenant/build before planning');
            const root = graph.states.find(state => state.observation.url === graph.scope!.seedUrl && !state.observation.dialogs.length);
            const relevant = graph.states.filter(state => state.id === root?.id || terms.some(term => (state.observation.headings.join(' ') + ' ' + state.observation.dialogs.join(' ') + ' ' + state.observation.url).toLowerCase().includes(term))).sort((a, b) => a.observation.dialogs.length - b.observation.dialogs.length).slice(0, 8);
            navigation.push({ roleId, states: relevant.map(state => {
                    let path: string[] | null = null;
                    try {
                        if (root)
                            path = findPath(graph, root.id, state.id).map(edge => edge.id);
                    }
                    catch { }
                    return { id: state.id, url: state.observation.url, headings: state.observation.headings, dialogs: state.observation.dialogs, controls: state.observation.controls.map(c => ({ role: c.role, name: c.name, testId: c.testId })), approvedPath: path };
                }) });
        }
        const context = { story: { title: story.title, requirements: story.requirements.map(r => ({ id: r.id, key: r.key, text: r.text, sourceRef: r.sourceRef, origin: r.origin, approved: r.approved })) }, scope: story.context, navigation, policy, assertionLocators: [{ kind: 'role', role: 'alert', name: '' }, { kind: 'role', role: 'status', name: '' }], instructions: 'Use label locators for form inputs and button role for submission. Role HTTP cases may target the root state. Never submit login credentials. Select existing state IDs with approvedPath, including empty root paths. Each scenario is independent. Use generated-password for Password, unique-email for valid registration, duplicate-email for existing fixture. Invalid email is a literal such as invalid-email. Only explicit criteria define expected messages or HTTP statuses.' };
        const secrets = [policy.fixtures ? this.env[policy.fixtures.tokenEnv] : undefined, ...story.context.roleIds.flatMap(id => { const auth = this.store.getRole(id)?.auth; return auth?.kind === 'form' ? [this.env[auth.usernameEnv], this.env[auth.passwordEnv]] : []; })].filter((v): v is string => !!v);
        let summary = JSON.stringify(context);
        for (const secret of secrets)
            summary = summary.split(secret).join('[redacted]');
        summary = summary.replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email]');
        if (summary.length > 16000)
            throw new Error('Relevant context exceeds planning budget; narrow the story');
        const proposal = proposalSchema.parse(await provider.plan({ summary }, signal));
        signal?.throwIfAborted();
        const capabilities = provider.capabilities();
        const validation = provider instanceof CodexPlanningAdapter ? provider.validationRecord() : null;
        const plan = this.store.testing.savePlan(story.id, proposal, policy, { id: capabilities.id, synthetic: capabilities.synthetic, validationId: validation?.id ?? null });
        for (const inference of proposal.inferredRequirements)
            this.store.testing.addInference(story.id, inference.text, capabilities.id);
        return plan;
    }
    startPlanning(storyId: string, policy: TestPolicy): QaJob { return this.job('plan', storyId, async (signal, progress) => { progress('Validating provider isolation and retrieving scoped navigation'); return (await this.plan(storyId, policy, signal)).id; }); }
    startExecution(planId: string, selected?: string[]): QaJob { return this.job('execute', planId, async (signal, progress) => { const report = await new TestExecutor(this.store, this.artifacts, this.browser, this.env).execute(planId, selected, signal, (run, message) => progress(message, run.id)); return report.run.id; }); }
    private job(kind: QaJob['kind'], referenceId: string, work: (signal: AbortSignal, progress: (message: string, resultId?: string) => void) => Promise<string>): QaJob {
        const job = this.store.testing.createJob(kind, referenceId);
        const controller = new AbortController();
        const promise = work(controller.signal, (message, resultId) => this.store.testing.updateJob(job.id, 'running', message, resultId)).then(id => { this.store.testing.updateJob(job.id, controller.signal.aborted ? 'cancelled' : 'complete', 'Work complete', id); }).catch(error => { const message = error instanceof Error ? error.message : 'Operation failed'; this.store.testing.updateJob(job.id, controller.signal.aborted ? 'cancelled' : 'failed', message.slice(0, 500)); }).finally(() => this.pending.delete(job.id));
        this.pending.set(job.id, { controller, promise });
        return this.store.testing.getJob(job.id)!;
    }
    cancel(id: string) {
        const task = this.pending.get(id);
        if (!task)
            throw new Error('Job is not active in this process');
        task.controller.abort();
    }
    async shutdown() {
        for (const task of this.pending.values())
            task.controller.abort();
        await Promise.allSettled([...this.pending.values()].map(task => task.promise));
    }
}
