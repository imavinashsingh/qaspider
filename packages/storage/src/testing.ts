import {derivePermissions,permissionRequirementSchema,permissionDecisionInputSchema,type PermissionDecisionInput,type PermissionDecision,type ExecutionAuthorization} from '../../core/src/permissions.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseStory, providerMetadataSchema, storyContextSchema, proposalSchema, policySchema, scenarioScope, classifyAttempts, hash, type TestingRepository, type StoryContext, type StoryRevision, type Requirement, type PlanProposal, type PlanRevision, type TestPolicy, type TestRun, type AttemptResult, type TestReport, type FixtureReservation, type QaJob, type Environment, type RoleProfile, type Outcome } from '../../core/src/index.js';
type Row = Record<string, unknown>;
export class SqliteTestingRepository implements TestingRepository {
    constructor(private readonly db: Database.Database, private readonly environment: (id: string) => Environment | undefined, private readonly role: (id: string) => RoleProfile | undefined) { }
    private atomic<T>(work: () => T) { return this.db.transaction(work).immediate(); }
    private context(input: StoryContext) {
        const context = storyContextSchema.parse(input);
        const env = this.environment(context.environmentId);
        if (!env || env.applicationId !== context.applicationId || context.roleIds.some(id => this.role(id)?.environmentId !== env.id))
            throw new Error('Invalid story scope');
        return context;
    }
    importStory(markdown: string, sourceRef: string, input: StoryContext, existingId?: string): StoryRevision {
        return this.atomic(() => {
            const parsed = parseStory(markdown, sourceRef);
            const context = this.context(input);
            const storyId = existingId ?? randomUUID();
            if (existingId) {
                const row = this.db.prepare('SELECT application_id FROM stories WHERE id=?').get(existingId) as Row | undefined;
                if (!row || row.application_id !== context.applicationId)
                    throw new Error('Unknown story application');
            }
            else
                this.db.prepare('INSERT INTO stories VALUES (?,?)').run(storyId, context.applicationId);
            const revision = Number((this.db.prepare('SELECT coalesce(max(revision),0)+1 AS n FROM story_revisions WHERE story_id=?').get(storyId) as Row).n);
            const id = randomUUID();
            this.db.prepare('INSERT INTO story_revisions VALUES (?,?,?,?,?,?,?,?)').run(id, storyId, revision, parsed.title, markdown, sourceRef, JSON.stringify(context), Date.now());
            const insert = this.db.prepare('INSERT INTO requirements VALUES (?,?,?,?,?,?)');
            for (const req of parsed.requirements)
                insert.run(randomUUID(), id, req.key, req.text, req.sourceRef, req.origin);
            return this.getStory(id)!;
        });
    }
    private requirement(row: Row): Requirement { return { id: String(row.id), key: String(row.criterion_key), text: String(row.text), sourceRef: String(row.source_ref), origin: row.origin as Requirement['origin'], approved: !!this.db.prepare('SELECT 1 FROM requirement_approvals WHERE requirement_id=?').get(row.id) }; }
    getStory(id: string): StoryRevision | undefined {
        const row = this.db.prepare('SELECT * FROM story_revisions WHERE id=?').get(id) as Row | undefined;
        if (!row)
            return undefined;
        return { id: String(row.id), storyId: String(row.story_id), revision: Number(row.revision), title: String(row.title), markdown: String(row.markdown), sourceRef: String(row.source_ref), context: storyContextSchema.parse(JSON.parse(String(row.context_json))), requirements: (this.db.prepare('SELECT * FROM requirements WHERE story_revision_id=? ORDER BY rowid').all(id) as Row[]).map(row => this.requirement(row)) };
    }
    listStories() { return (this.db.prepare('SELECT id FROM story_revisions ORDER BY created_at DESC').all() as Row[]).map(row => this.getStory(String(row.id))!); }
    addInference(storyRevisionId: string, text: string, provider: string): Requirement {
        if (!this.getStory(storyRevisionId))
            throw new Error('Unknown story');
        z.string().min(1).max(1000).parse(text);
        const id = randomUUID();
        this.db.prepare('INSERT INTO requirements VALUES (?,?,?,?,?,?)').run(id, storyRevisionId, `AI-${id.slice(0, 8)}`, text, `provider:${provider}`, 'ai-inferred');
        return this.requirement(this.db.prepare('SELECT * FROM requirements WHERE id=?').get(id) as Row);
    }
    private validate(story: StoryRevision, proposal: PlanProposal, policy: TestPolicy, proposed=false) {
        const context = this.context(story.context);
        const env = this.environment(context.environmentId)!;
        for (const grant of [...policy.actionGrants, ...policy.readGrants])
            if (!context.roleIds.includes(grant.roleId) || !env.allowedOrigins.includes(new URL(grant.url).origin))
                throw new Error('Policy grant outside story scope');
        if (policy.fixtures && ![policy.fixtures.setupUrl, policy.fixtures.cleanupUrl].every(url => env.allowedOrigins.includes(new URL(url).origin)))
            throw new Error('Fixture origin outside story scope');
        for (const scenario of proposal.scenarios) {
            scenarioScope(context, scenario);
            for (const id of scenario.requirementIds)
                if (!story.requirements.some(req => req.id === id))
                    throw new Error('Unknown requirement source');
            for (const grant of scenario.allowedActions)
                if (grant.roleId !== scenario.roleId || !env.allowedOrigins.includes(new URL(grant.url).origin) || (!proposed && !policy.actionGrants.some(item => hash(item) === hash(grant))))
                    throw new Error('Scenario action lacks policy permission');
            for (const step of scenario.steps)
                if (step.kind === 'click' && step.submitUrl && (!env.allowedOrigins.includes(new URL(step.submitUrl).origin) || (!proposed && !scenario.allowedActions.some(grant => grant.url === step.submitUrl && grant.method === 'POST'))))
                    throw new Error('Submission outside scope or missing explicit allowed action');
            for (const assertion of scenario.assertions)
                if (assertion.kind === 'http-status' && (!env.allowedOrigins.includes(new URL(assertion.url).origin) || (!proposed && !policy.readGrants.some(grant => grant.roleId === scenario.roleId && grant.url === assertion.url))))
                    throw new Error('HTTP assertion requires a declared read grant');
        }
    }
    savePlan(storyRevisionId: string, input: PlanProposal, policyInput: TestPolicy, provider: PlanRevision['provider'], existingPlanId?: string, proposed=false): PlanRevision {
        return this.atomic(() => {
            const story = this.getStory(storyRevisionId);
            if (!story)
                throw new Error('Unknown story revision');
            const proposal = proposalSchema.parse(input);
            const policy = policySchema.parse(policyInput);
            this.validate(story, proposal, policy, proposed);
            const planId = existingPlanId ?? randomUUID();
            if (!existingPlanId)
                this.db.prepare('INSERT INTO plans VALUES (?,?)').run(planId, story.storyId);
            else {
                const old = this.db.prepare('SELECT story_id FROM plans WHERE id=?').get(planId) as Row | undefined;
                if (old?.story_id !== story.storyId)
                    throw new Error('Cross-story plan revision');
            }
            const revision = Number((this.db.prepare('SELECT coalesce(max(revision),0)+1 AS n FROM plan_revisions WHERE plan_id=?').get(planId) as Row).n);
            const id = randomUUID();
            this.db.prepare('INSERT INTO plan_revisions VALUES (?,?,?,?,?,?,?,?,?)').run(id, planId, revision, storyRevisionId, JSON.stringify(proposal), JSON.stringify(policy), hash({ storyRevisionId, proposal, policy }), JSON.stringify(providerMetadataSchema.parse(provider)), Date.now());
            if(proposed)this.db.prepare('INSERT INTO permission_workflows VALUES (?,?)').run(id,Date.now());
            return this.getPlan(id)!;
        });
    }
    saveProposedPlan(storyId:string,proposal:PlanProposal,policy:TestPolicy,provider:PlanRevision['provider'],planId?:string){return this.savePlan(storyId,proposal,policy,provider,planId,true);}
    revisePlan(baseId: string, proposal: PlanProposal) {
        const previous = this.getPlan(baseId);
        if (!previous)
            throw new Error('Unknown plan');
        return this.savePlan(previous.storyRevisionId, proposal, previous.policy, previous.provider, previous.planId,true);
    }
    getPlan(id: string): PlanRevision | undefined {
        const row = this.db.prepare('SELECT * FROM plan_revisions WHERE id=?').get(id) as Row | undefined;
        if (!row)
            return undefined;
        const proposal = proposalSchema.parse(JSON.parse(String(row.proposal_json)));
        const policy = policySchema.parse(JSON.parse(String(row.policy_json)));
        const contentHash = hash({ storyRevisionId: String(row.story_revision_id), proposal, policy });
        if (contentHash !== row.content_hash)
            throw new Error('Plan content hash mismatch');
        const approved = this.db.prepare('SELECT content_hash FROM plan_approvals WHERE plan_revision_id=?').get(id) as Row | undefined;
        if (approved && approved.content_hash !== contentHash)
            throw new Error('Approval content hash mismatch');
        return { id: String(row.id), planId: String(row.plan_id), revision: Number(row.revision), storyRevisionId: String(row.story_revision_id), proposal, policy, hash: contentHash, status: approved ? 'approved' : 'draft', provider: JSON.parse(String(row.provider_json)) as PlanRevision['provider'], createdAt: Number(row.created_at) };
    }
    listPlans() { return (this.db.prepare('SELECT id FROM plan_revisions ORDER BY created_at DESC').all() as Row[]).map(row => this.getPlan(String(row.id))!); }
    approvePlan(id: string, reviewer: string, requirementIds: string[]): PlanRevision {
        return this.atomic(() => {
            z.string().trim().min(1).max(200).parse(reviewer);
            const plan = this.getPlan(id);
            if (!plan)
                throw new Error('Unknown plan');
            const latest = this.db.prepare('SELECT max(revision) AS n FROM plan_revisions WHERE plan_id=?').get(plan.planId) as Row;
            if (Number(latest.n) !== plan.revision)
                throw new Error('Only the latest plan revision may be approved');
            const story = this.getStory(plan.storyRevisionId)!;
            this.validate(story, plan.proposal, plan.policy,this.managed(id));
            for (const reqId of requirementIds) {
                if (!story.requirements.some(req => req.id === reqId))
                    throw new Error('Cross-story requirement approval');
                if (!story.requirements.find(req => req.id === reqId)!.approved)
                    this.db.prepare('INSERT INTO requirement_approvals VALUES (?,?,?,?)').run(randomUUID(), reqId, reviewer, Date.now());
            }
            const refreshed = this.getStory(story.id)!;
            for (const scenario of plan.proposal.scenarios)
                for (const reqId of scenario.requirementIds)
                    if (!refreshed.requirements.find(req => req.id === reqId)?.approved)
                        throw new Error('Every cited requirement needs explicit approval');
            this.db.prepare('INSERT OR IGNORE INTO plan_approvals VALUES (?,?,?,?,?)').run(randomUUID(), id, plan.hash, reviewer, Date.now());
            return this.getPlan(id)!;
        });
    }
    private managed(id:string){return !!this.db.prepare('SELECT 1 FROM permission_workflows WHERE plan_revision_id=?').get(id);}
    permissions(id:string):ExecutionAuthorization {
        const plan=this.getPlan(id);if(!plan)throw new Error('Unknown plan revision');
        const decisions=(this.db.prepare('SELECT * FROM permission_decisions WHERE plan_revision_id=? ORDER BY rowid').all(id) as Row[]).map(row=>({id:String(row.id),planRevisionId:id,planHash:String(row.plan_hash),scope:storyContextSchema.parse(JSON.parse(String(row.scope_json))),permissionId:String(row.permission_id),request:permissionRequirementSchema.parse(JSON.parse(String(row.request_json))),decision:row.decision as 'allow'|'deny',reviewer:String(row.reviewer),decidedAt:Number(row.decided_at)})) as PermissionDecision[];
        const scope=this.getStory(plan.storyRevisionId)!.context;
        const requirements=derivePermissions(plan).map(r=>{const last=decisions.filter(d=>d.permissionId===r.id&&d.planHash===plan.hash&&hash(d.scope)===hash(scope)&&hash({...d.request,status:'pending'})===hash({...r,status:'pending'})).at(-1);return {...r,status:last?.decision??r.status};});
        return {planRevisionId:id,planHash:plan.hash,managed:this.managed(id),requirements,decisions};
    }
    decidePermissions(id:string,expectedHash:string,input:PermissionDecisionInput[],reviewer:string):ExecutionAuthorization {
        return this.atomic(()=>{
            z.string().trim().min(1).max(200).parse(reviewer);const plan=this.getPlan(id);
            if(!plan||plan.hash!==expectedHash||!this.managed(id))throw new Error('Unknown or changed plan revision');
            const latest=this.db.prepare('SELECT max(revision) AS n FROM plan_revisions WHERE plan_id=?').get(plan.planId) as Row;
            if(Number(latest.n)!==plan.revision)throw new Error('Decide permissions on the latest revision');
            const values=z.array(permissionDecisionInputSchema).max(200).parse(input);if(new Set(values.map(v=>v.permissionId)).size!==values.length)throw new Error('Duplicate permission decision');
            const story=this.getStory(plan.storyRevisionId)!;const environment=this.environment(story.context.environmentId)!;
            for(const value of values){const request=derivePermissions(plan).find(r=>r.id===value.permissionId);if(!request)throw new Error('Unknown permission request');
                if(value.decision==='allow'&&(!request.url||!environment.allowedOrigins.includes(new URL(request.url).origin)||environment.kind==='production'&&request.changesData))throw new Error('Unsupported permission or forbidden scope');
                this.db.prepare('INSERT INTO permission_decisions VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,plan.hash,JSON.stringify(story.context),request.id,JSON.stringify(request),value.decision,reviewer,Date.now());
            }return this.permissions(id);
        });
    }
    configureAccess(id:string,input:TestPolicy):PlanRevision {
        const plan=this.getPlan(id);if(!plan||!this.managed(id))throw new Error('Unknown proposed plan');
        const policy=policySchema.parse(input);if(policy.discovery)throw new Error('Planning and authorization cannot discover');
        return this.saveProposedPlan(plan.storyRevisionId,plan.proposal,policy,plan.provider,plan.planId);
    }
    assertAuthorized(id:string,scenarioId:string):void {
        const plan=this.getPlan(id);if(plan?.status!=='approved')throw new Error('Exact plan revision is not approved');
        const story=this.getStory(plan.storyRevisionId)!;this.validate(story,plan.proposal,plan.policy,this.managed(id));
        if(!plan.proposal.scenarios.some(s=>s.id===scenarioId))throw new Error('Unknown scoped scenario');
        if(this.managed(id)){const latest=this.db.prepare('SELECT max(revision) AS n FROM plan_revisions WHERE plan_id=?').get(plan.planId) as Row;if(Number(latest.n)!==plan.revision)throw new Error('Plan revision superseded; review current permissions');}
        if(!this.managed(id))return; // Legacy plans retain their explicitly supplied, immutable policy contract.
        const missing=this.permissions(id).requirements.find(r=>r.scenarioIds.includes(scenarioId)&&r.status!=='allow');
        if(missing)throw new Error(`Required permission ${missing.status}: ${missing.name}`);
    }
    executionPolicy(id:string,scenarioId:string):TestPolicy {
        this.assertAuthorized(id,scenarioId);
        const plan=this.getPlan(id)!;
        if(!this.managed(id))return plan.policy;
        const requests=this.permissions(id).requirements.filter(r=>r.scenarioIds.includes(scenarioId)&&r.status==='allow');
        return policySchema.parse({
            actionGrants:requests.filter(r=>r.kind==='submit').map(r=>({roleId:r.roleId,url:r.url!,method:'POST'})),
            readGrants:requests.filter(r=>r.kind==='read').map(r=>({roleId:r.roleId,url:r.url!})),
            fixtures:requests.some(r=>r.kind==='fixture-cleanup')?plan.policy.fixtures:null,
            discovery:false
        });
    }
    private run(row: Row): TestRun { return { id: String(row.id), planRevisionId: String(row.plan_revision_id), status: row.status as TestRun['status'], startedAt: Number(row.started_at), finishedAt: row.finished_at === null ? null : Number(row.finished_at), selectedScenarioIds: JSON.parse(String(row.selected_json)) as string[] }; }
    startRun(planRevisionId: string, selected?: string[]): TestRun {
        return this.atomic(() => {
            const plan = this.getPlan(planRevisionId);
            if (plan?.status !== 'approved')
                throw new Error('Execution requires an approved exact plan revision');
            const ids = selected ?? plan.proposal.scenarios.map(s => s.id);
            if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !plan.proposal.scenarios.some(s => s.id === id)))
                throw new Error('Invalid scenario selection');
            const id = randomUUID();
            this.db.prepare("INSERT INTO test_runs VALUES (?,?, 'running',?,NULL,?)").run(id, planRevisionId, Date.now(), JSON.stringify(ids));
            for (const scenario of plan.proposal.scenarios)
                this.db.prepare("INSERT INTO test_scenario_results VALUES (?,?,?,'NOT RUN')").run(id, scenario.id, scenario.roleId);
            return this.run(this.db.prepare('SELECT * FROM test_runs WHERE id=?').get(id) as Row);
        });
    }
    recordAttempt(runId: string, scenarioId: string, attempt: number, result: AttemptResult): void {
        this.atomic(() => {
            const report = this.report(runId);
            const scenario = report?.plan.proposal.scenarios.find(s => s.id === scenarioId);
            if (!report || report.run.status !== 'running' || !scenario || !report.run.selectedScenarioIds.includes(scenarioId))
                throw new Error('Unknown active selected scenario');
            if (attempt < 1 || attempt > scenario.retries + 1)
                throw new Error('Attempt outside approved retry budget');
            if (new Set(result.assertions.map(a => a.id)).size !== result.assertions.length)
                throw new Error('Duplicate assertion results');
            if (result.status === 'PASS' && (result.assertions.length !== scenario.assertions.length || result.assertions.some(a => a.status !== 'PASS') || !result.evidenceIds.length))
                throw new Error('PASS requires every approved assertion and evidence');
            for (const actual of result.assertions) {
                const expected = scenario.assertions.find(a => a.id === actual.id);
                if (!expected || JSON.stringify(expected.expected) !== JSON.stringify(actual.expected) || expected.requirementId !== actual.requirementId || !report.story.requirements.find(r => r.id === actual.requirementId)?.approved)
                    throw new Error('Assertion lacks approved expectation');
                if (actual.status === 'PASS' && (expected.kind === 'text' ? (typeof actual.actual !== 'string' || (expected.comparison === 'equals' ? actual.actual !== expected.expected : !actual.actual.includes(expected.expected))) : actual.actual !== expected.expected))
                    throw new Error('PASS contradicts approved assertion');
                const evidence = this.db.prepare("SELECT run_id FROM artifacts WHERE id=? AND status='available'").get(actual.evidenceId) as Row | undefined;
                if (!evidence || evidence.run_id !== runId)
                    throw new Error('Assertion evidence outside run');
            }
            this.db.prepare('INSERT INTO test_attempts VALUES (?,?,?,?,?)').run(randomUUID(), runId, scenarioId, attempt, JSON.stringify(result));
            for (const actual of result.assertions)
                this.db.prepare('INSERT INTO assertion_results VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), runId, scenarioId, attempt, actual.id, actual.requirementId, actual.status, JSON.stringify(actual.expected), JSON.stringify(actual.actual), actual.evidenceId);
            const attempts = (this.db.prepare('SELECT result_json FROM test_attempts WHERE run_id=? AND scenario_id=? ORDER BY attempt').all(runId, scenarioId) as Row[]).map(row => (JSON.parse(String(row.result_json)) as AttemptResult).status);
            this.db.prepare('UPDATE test_scenario_results SET status=? WHERE run_id=? AND scenario_id=?').run(classifyAttempts(attempts), runId, scenarioId);
        });
    }
    finishRun(id: string, status: TestRun['status']) { this.db.prepare('UPDATE test_runs SET status=?,finished_at=? WHERE id=?').run(status, Date.now(), id); }
    listRuns() { return (this.db.prepare('SELECT * FROM test_runs ORDER BY started_at DESC').all() as Row[]).map(row => this.run(row)); }
    report(id: string): TestReport | undefined {
        const row = this.db.prepare('SELECT * FROM test_runs WHERE id=?').get(id) as Row | undefined;
        if (!row)
            return undefined;
        const run = this.run(row);
        const plan = this.getPlan(run.planRevisionId)!;
        const story = this.getStory(plan.storyRevisionId)!;
        const results = (this.db.prepare('SELECT * FROM test_scenario_results WHERE run_id=? ORDER BY rowid').all(id) as Row[]).map(row => ({ scenarioId: String(row.scenario_id), roleId: String(row.role_id), status: row.status as Outcome, attempts: (this.db.prepare('SELECT result_json FROM test_attempts WHERE run_id=? AND scenario_id=? ORDER BY attempt').all(id, row.scenario_id) as Row[]).map(row => JSON.parse(String(row.result_json)) as AttemptResult) }));
        const summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE', 'FLAKY', 'NOT RUN'].map(key => [key, results.filter(r => r.status === key).length])) as Record<Outcome, number>;
        return { run, plan, story, results, summary, fixtures: (this.db.prepare('SELECT * FROM fixture_reservations WHERE run_id=?').all(id) as Row[]).map(row => this.fixture(row)) };
    }
    private fixture(row: Row): FixtureReservation { return { id: String(row.id), runId: String(row.run_id), scenarioId: String(row.scenario_id), attempt: Number(row.attempt), kind: row.kind as FixtureReservation['kind'], status: row.status as FixtureReservation['status'], message: String(row.message) }; }
    reserveFixture(runId: string, scenarioId: string, attempt: number, kind: FixtureReservation['kind']): FixtureReservation { const id = randomUUID(); this.db.prepare("INSERT INTO fixture_reservations VALUES (?,?,?,?,?,'reserved','')").run(id, runId, scenarioId, attempt, kind); return this.fixture(this.db.prepare('SELECT * FROM fixture_reservations WHERE id=?').get(id) as Row); }
    updateFixture(id: string, status: FixtureReservation['status'], message = '') { this.db.prepare('UPDATE fixture_reservations SET status=?,message=? WHERE id=?').run(status, message, id); }
    private job(row: Row): QaJob { return { id: String(row.id), kind: row.kind as QaJob['kind'], status: row.status as QaJob['status'], referenceId: String(row.reference_id), resultId: row.result_id === null ? null : String(row.result_id), message: String(row.message) }; }
    createJob(kind: QaJob['kind'], referenceId: string): QaJob { const id = randomUUID(); this.db.prepare("INSERT INTO qa_jobs VALUES (?,?,'running',?,NULL,'Starting',?,?)").run(id, kind, referenceId, Date.now(), Date.now()); return this.getJob(id)!; }
    updateJob(id: string, status: QaJob['status'], message: string, resultId?: string) { this.db.prepare('UPDATE qa_jobs SET status=?,message=?,result_id=coalesce(?,result_id),updated_at=? WHERE id=?').run(status, message, resultId ?? null, Date.now(), id); }
    getJob(id: string): QaJob | undefined { const row = this.db.prepare('SELECT * FROM qa_jobs WHERE id=?').get(id) as Row | undefined; return row ? this.job(row) : undefined; }
}
