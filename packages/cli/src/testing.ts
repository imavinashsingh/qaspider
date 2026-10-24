import {configuredProviderFactory} from '../../studio/src/settings.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { policySchema, proposalSchema, storyContextSchema,permissionDecisionInputSchema } from '../../core/src/index.js';
import { QaService } from '../../qa/src/service.js';
import { TestExecutor } from '../../qa/src/execution.js';
import { CodexPlanningAdapter } from '../../providers/src/codex.js';
export async function runTestingCli(args: string[], output: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> {
    let store: SqliteStore | undefined;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    try {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { workspace: { type: 'string' }, file: { type: 'string' }, context: { type: 'string' }, source: { type: 'string' }, story: { type: 'string' }, policy: { type: 'string' }, plan: { type: 'string' }, reviewer: { type: 'string' }, requirements: { type: 'string' }, scenarios: { type: 'string' }, run: { type: 'string' }, 'no-ai': { type: 'boolean' }, hash:{type:'string'} } });
        const [command, operation, ...extra] = positionals;
        if (extra.length)
            throw new Error('Invalid command');
        const provider = new CodexPlanningAdapter();
        if (command === 'provider' && operation === 'validate') {
            output(JSON.stringify(await provider.validateIsolation(controller.signal)));
            return 0;
        }
        const directory = join(resolve(values.workspace ?? '.'), '.qaspider');
        const database = join(directory, 'memory.db');
        if (!existsSync(database))
            throw new Error('Workspace not initialized');
        store = new SqliteStore(database);
        const artifacts = new ArtifactStore(store, join(directory, 'artifacts'));
        const service = new QaService(store, artifacts, configuredProviderFactory(resolve(values.workspace??'.')), undefined, env);
        const file = () => {
            if (!values.file)
                throw new Error('A file is required');
            return readFileSync(resolve(values.file), 'utf8');
        };
        if (command === 'story' && operation === 'import') {
            if (!values.context)
                throw new Error('Story scope context file required');
            const context = storyContextSchema.parse(JSON.parse(readFileSync(resolve(values.context), 'utf8')));
            output(JSON.stringify(store.testing.importStory(file(), values.source ?? values.file!, context, values.story)));
            return 0;
        }
        if (command === 'story' && operation === 'list') {
            output(JSON.stringify(store.testing.listStories()));
            return 0;
        }
        if (command === 'plan' && operation === 'generate') {
            if (!values.story)
                throw new Error('Story revision required');
            output(JSON.stringify(await service.plan(values.story, values.policy?policySchema.parse(JSON.parse(readFileSync(resolve(values.policy), 'utf8'))):undefined, controller.signal)));
            return 0;
        }
        if(command==='plan'&&operation==='permissions'){output(JSON.stringify(store.testing.permissions(values.plan??'')));return 0;}
        if(command==='plan'&&operation==='authorize'){
            if(!values.plan||!values.hash||!values.reviewer)throw new Error('Exact plan, hash, reviewer and decision file required');
            output(JSON.stringify(store.testing.decidePermissions(values.plan,values.hash,permissionDecisionInputSchema.array().parse(JSON.parse(file())),values.reviewer)));return 0;
        }
        if(command==='plan'&&operation==='configure-access'){
            output(JSON.stringify(store.testing.configureAccess(values.plan??'',policySchema.parse(JSON.parse(file())))));return 0;
        }
        if (command === 'plan' && operation === 'list') {
            output(JSON.stringify(store.testing.listPlans()));
            return 0;
        }
        if (command === 'plan' && operation === 'show') {
            const plan = store.testing.getPlan(values.plan ?? '');
            if (!plan)
                throw new Error('Unknown plan revision');
            output(JSON.stringify(plan));
            return 0;
        }
        if (command === 'plan' && operation === 'edit') {
            if (!values.plan)
                throw new Error('Plan revision required');
            output(JSON.stringify(store.testing.revisePlan(values.plan, proposalSchema.parse(JSON.parse(file())))));
            return 0;
        }
        if (command === 'plan' && operation === 'approve') {
            if (!values.plan || !values.reviewer || !values.requirements)
                throw new Error('Exact plan revision, reviewer and explicit requirement IDs required');
            output(JSON.stringify(store.testing.approvePlan(values.plan, values.reviewer, values.requirements.split(','))));
            return 0;
        }
        if (command === 'test' && ['run', 'replay'].includes(operation ?? '')) {
            if (!values.plan)
                throw new Error('Approved plan revision required');
            const report = await new TestExecutor(store, artifacts, undefined, env).execute(values.plan, values.scenarios?.split(','), controller.signal);
            output(JSON.stringify({ ...report, providerUsed: false }));
            return report.summary.FAIL || report.summary.BLOCKED || report.summary.INCONCLUSIVE ? 1 : 0;
        }
        if (command === 'report' && !operation) {
            const report = store.testing.report(values.run ?? '');
            if (!report)
                throw new Error('Run required');
            output(JSON.stringify(report));
            return 0;
        }
        throw new Error('Use story import/list, plan generate/show/edit/approve/list, test run/replay, report or provider validate');
    }
    catch (error) {
        output(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'QA operation failed' }));
        return 1;
    }
    finally {
        process.off('SIGINT', cancel);
        process.off('SIGTERM', cancel);
        store?.close();
    }
}
