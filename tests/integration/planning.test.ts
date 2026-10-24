import { it, expect } from 'vitest';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { QaService } from '../../packages/qa/src/service.js';
import { FakeProvider, navigationConfigSchema, normalizeObservation, type TestPolicy } from '../../packages/core/src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
it('retrieves only scoped relevant memory, redacts secrets, labels synthetic plans and rejects foreign grants before provider invocation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-planning-'));
    const store = new SqliteStore(':memory:');
    try {
        store.createApplication({ id: 'app', name: 'App' });
        store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['http://localhost:3000'] });
        store.createRole({ id: 'guest', environmentId: 'qa', name: 'Guest', auth: { kind: 'guest' } });
        const scope = { applicationId: 'app', environmentId: 'qa', roleId: 'guest', build: 'b1', tenant: 'public', featureFlags: {} };
        const config = navigationConfigSchema.parse({});
        store.navigation.ensureScope(scope, 'http://localhost:3000/', config);
        const artifacts = new ArtifactStore(store, join(root, 'artifacts'));
        const navRun = store.navigation.startRun(scope, 'map');
        const evidence = artifacts.put(navRun.id, Buffer.from('{}'), 'event-log');
        const state = store.navigation.saveState(scope, normalizeObservation({ url: 'http://localhost:3000/', headings: ['Registration'], controls: [], dialogs: [] }, config), evidence.id);
        const story = store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Status shows Registered. The opaque fixture token is private-value.', 'story.md', { applicationId: 'app', environmentId: 'qa', roleIds: ['guest'], build: 'b1', tenant: 'public', featureFlags: {} });
        let calls = 0;
        class Planner extends FakeProvider {
            override async plan(context: {
                summary: string;
            }) { calls++; expect(context.summary).not.toContain('private-value'); expect(context.summary).toContain(state.id); expect(context.summary).not.toContain('raw trace'); return { title: 'Synthetic', feature: 'Registration', inferredRequirements: [{ text: 'Needs review' }], scenarios: [{ id: 'case', title: 'Register', roleId: 'guest', requirementIds: [story.requirements[0]!.id], targetStateId: state.id, data: [], steps: [], assertions: [{ id: 'ok', requirementId: story.requirements[0]!.id, kind: 'visible', locator: { kind: 'role', role: 'heading', name: 'Registration' }, expected: true }], allowedActions: [], cleanup: 'owned-fixtures', severity: 'low', retries: 0 }] }; }
        }
        const policy: TestPolicy = { actionGrants: [], readGrants: [], fixtures: { setupUrl: 'http://localhost:3000/setup', cleanupUrl: 'http://localhost:3000/cleanup', tokenEnv: 'FIXTURE_TOKEN', emailDomain: 'example.test' }, discovery: false };
        const qa = new QaService(store, artifacts, new Planner(), undefined, { FIXTURE_TOKEN: 'private-value' });
        await expect(qa.plan(story.id, { ...policy, actionGrants: [{ roleId: 'guest', url: 'https://evil.test/write', method: 'POST' }] })).rejects.toThrow('scope');
        expect(calls).toBe(0);
        const plan = await qa.plan(story.id);
        expect(calls).toBe(1);
        expect(plan.provider.synthetic).toBe(true);
        expect(plan.status).toBe('draft');
        expect(store.testing.getStory(story.id)?.requirements.at(-1)?.approved).toBe(false);
    }
    finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
