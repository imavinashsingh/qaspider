import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../../packages/storage/src/index.js';
it('persists M2 source revisions and refuses SQL mutations of historical requirements and plans', () => {
    const directory = mkdtempSync(join(tmpdir(), 'qa-history-'));
    const path = join(directory, 'memory.db');
    let store = new SqliteStore(path);
    try {
        store.createApplication({ id: 'app', name: 'App' });
        store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['http://localhost:3000'] });
        store.createRole({ id: 'guest', environmentId: 'qa', name: 'Guest', auth: { kind: 'guest' } });
        const markdown = '# Registration\n## Acceptance Criteria\n- AC-1: Heading reads Registration.';
        const story = store.testing.importStory(markdown, 'story.md', { applicationId: 'app', environmentId: 'qa', roleIds: ['guest'], build: 'b1', tenant: 'public', featureFlags: {} });
        const req = story.requirements[0]!;
        const plan = store.testing.savePlan(story.id, { title: 'Plan', feature: 'Registration', inferredRequirements: [], scenarios: [{ id: 'case', title: 'Heading', roleId: 'guest', requirementIds: [req.id], targetStateId: 'target', data: [], steps: [], assertions: [{ id: 'heading', requirementId: req.id, kind: 'text', locator: { kind: 'role', role: 'heading', name: 'Registration' }, expected: 'Registration', comparison: 'equals' }], allowedActions: [], cleanup: 'owned-fixtures', severity: 'low', retries: 0 }] }, { actionGrants: [], readGrants: [], fixtures: null, discovery: false }, { id: 'fixture', synthetic: true, validationId: null });
        store.testing.approvePlan(plan.id, 'owner', [req.id]);
        store.close();
        store = new SqliteStore(path);
        expect(store.testing.getStory(story.id)?.markdown).toBe(markdown);
        expect(store.testing.getPlan(plan.id)).toMatchObject({ status: 'approved', hash: plan.hash });
        const raw = new Database(path);
        try {
            expect(() => raw.prepare('UPDATE requirements SET text=? WHERE id=?').run('Changed', req.id)).toThrow('Immutable');
            expect(() => raw.prepare('DELETE FROM story_revisions WHERE id=?').run(story.id)).toThrow('Immutable');
            expect(() => raw.prepare('UPDATE plan_revisions SET proposal_json=? WHERE id=?').run('{}', plan.id)).toThrow('Immutable');
            expect(() => raw.prepare('DELETE FROM plan_approvals WHERE plan_revision_id=?').run(plan.id)).toThrow('Immutable');
        }
        finally {
            raw.close();
        }
    }
    finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
