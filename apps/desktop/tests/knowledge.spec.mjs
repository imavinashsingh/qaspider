import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PlanStore } from '../electron/plan-store.mjs';
import { ApprovedExecution } from '../electron/approved-execution.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';
import { openBrowserSession } from '../electron/browser.mjs';
import { fixtureKnowledgeScope } from '../electron/knowledge.mjs';
import { knowledgeProposal as proposal } from './fixtures/knowledge-plan.mjs';
import { approve, executionIdentity, executionRequest } from './fixtures/approved-plan.mjs';

const folder = fileURLToPath(new URL('../../../test-results/desktop-live/m6/', import.meta.url));
mkdirSync(folder, { recursive: true });
function runner({ change = false, defect = false, noMemory = false } = {}) {
  return (input, settings) => runGenericScenario(input, { ...settings, memory: noMemory ? null : settings.memory, assertionTimeoutMs: 100,
    options: { headless: true, model: { generate: async () => { throw new Error('Synthetic observation test only'); } } },
    openSession: async (...args) => {
      const session = await openBrowserSession(...args);
      if (input.id === 'S-2') {
        if (change) await session.controlledPage.locator('button').evaluate(node => { const replacement = node.cloneNode(true); replacement.textContent = 'Send request'; node.parentElement.replaceChildren(replacement); });
        if (defect) await session.controlledPage.locator('form').evaluate(form => form.addEventListener('submit', () => { document.getElementById('result').textContent = 'Delivery failed'; }));
      }
      session.stagehand.observe = async () => ({ data: [{ selector: change ? 'footer button' : 'button', method: 'click', arguments: [] }] });
      return session;
    },
  });
}
async function execute(store, saved, mode) {
  const service = new ApprovedExecution(store, { runner: runner(mode) });
  try { return await service.execute(executionRequest(saved, await service.prepare(executionIdentity(saved)))); }
  finally { await service.close(); }
}
const contact = report => report.scenarios[1].result;
function exportEvidence(report, prefix) {
  for (const item of contact(report).evidence) writeFileSync(folder + prefix + '-' + item.stepNumber + '.png', Buffer.from(item.screenshot.split(',')[1], 'base64'));
}

test('Ticket A learns, Ticket B reuses after restart; exact scopes and operations gate retrieval', async () => {
  const data = folder + randomUUID() + '/'; mkdirSync(data);
  let store = new PlanStore(data + 'plans.sqlite');
  try {
    const a = approve(store, store.create(proposal())), reportA = await execute(store, a), beforeA = store.get(a.planId);
    expect(reportA.outcome).toBe('PASS'); expect(reportA.scenarios.every(item => !item.knowledgeMessage)).toBe(true);
    const compiled = reportA.scenarios[1].compatibility.plan, scope = fixtureKnowledgeScope(reportA.environment);
    const remembered = store.knowledge.find(scope, compiled);
    expect(remembered).toBeTruthy(); expect(contact(reportA).knowledge.metrics.discoveryCalls).toBe(1);
    for (const field of ['project', 'environment', 'role', 'application']) expect(store.knowledge.find({ ...scope, [field]: 'incorrect' }, compiled)).toBeNull();
    const different = structuredClone(compiled); different.steps.at(-1).assertion.expected = 'Different business expectation';
    expect(store.knowledge.find(scope, different)).toBeNull();
    expect(store.knowledge.list('contact-changed')).toHaveLength(1);
    expect(store.knowledge.list('" OR *')).toHaveLength(0);
    store.close(); store = new PlanStore(data + 'plans.sqlite');
    expect(store.knowledge.find(scope, compiled)).toEqual(remembered);
    const b = approve(store, store.create(proposal())), reportB = await execute(store, b);
    expect(reportB.outcome).toBe('PASS'); expect(reportB.scenarios.every(item => !item.knowledgeMessage)).toBe(true);
    expect(contact(reportB).knowledge.metrics.discoveryCalls).toBe(0); expect(contact(reportB).knowledge.metrics.reusedSteps).toBe(3);
    expect(store.get(a.planId)).toEqual(beforeA);
    const workflows = store.knowledge.list('contact-changed');
    expect(workflows[0].revisions).toHaveLength(1); expect(workflows[0].verifications).toHaveLength(2);
    expect(JSON.stringify(workflows)).not.toContain('qa@example.test'); expect(JSON.stringify(workflows)).not.toContain('Synthetic Tester');
    expect(() => store.db.prepare('DELETE FROM desktop_knowledge_revisions').run()).toThrow('append-only');
    exportEvidence(reportB, 'reused');
  } finally { store.close(); }
});

test('invalid knowledge preserves divergence evidence and creates a verified operational revision', async () => {
  const store = new PlanStore(':memory:');
  try {
    const a = approve(store, store.create(proposal())), reportA = await execute(store, a), before = store.get(a.planId);
    expect(reportA.outcome).toBe('PASS');
    const b = approve(store, store.create(proposal())), reportB = await execute(store, b, { change: true });
    expect(reportB.outcome).toBe('PASS'); expect(reportB.scenarios.every(item => !item.knowledgeMessage)).toBe(true);
    const workflow = store.knowledge.list('contact-changed')[0];
    expect(workflow.findings).toHaveLength(1); expect(workflow.revisions.map(item => item.status)).toEqual(['VERIFIED', 'VERIFIED']);
    expect(contact(reportB).knowledge.metrics.discoveryCalls).toBe(1);
    const finding = workflow.findings[0];
    expect(contact(reportB).evidence.find(item => item.id === finding.evidence_id)).toBeTruthy();
    expect(workflow.revisions[1].execution_id).toBe(reportA.id); expect(store.get(a.planId)).toEqual(before);
    expect(workflow.revisions[0].steps.find(item => item.kind === 'CLICK').selector).toBe('footer button');
    exportEvidence(reportB, 'changed');
    writeFileSync(folder + 'synthetic-change.json', JSON.stringify({ mode: 'real browser; synthetic Stagehand proposals; no AI inference', originalExecution: reportA.id, changedExecution: reportB.id, findings: workflow.findings, revisions: workflow.revisions, metrics: contact(reportB).knowledge.metrics }, null, 2));
  } finally { store.close(); }
});

test('business defect stays FAIL, candidate cannot replay, and original approval remains unchanged', async () => {
  const store = new PlanStore(':memory:');
  try {
    const saved = approve(store, store.create(proposal())), before = store.get(saved.planId);
    expect((await execute(store, saved)).outcome).toBe('PASS');
    const report = await execute(store, saved, { defect: true });
    expect(report.outcome).toBe('FAIL'); expect(report.scenarios.every(item => !item.knowledgeMessage)).toBe(true);
    const result = contact(report), failed = result.steps.find(item => item.outcome === 'FAIL');
    expect(failed.expected).toBe('Message received'); expect(failed.actual).toBe('Delivery failed');
    const workflow = store.knowledge.list('contact-changed')[0]; expect(workflow.revisions[0].status).toBe('CANDIDATE'); expect(workflow.findings).toHaveLength(1);
    expect(store.knowledge.find(fixtureKnowledgeScope(report.environment), report.scenarios[1].compatibility.plan)).toBeNull();
    expect(store.get(saved.planId)).toEqual(before); exportEvidence(report, 'defect');
  } finally { store.close(); }
});

test('a changed selector-only control cannot gain permission from its old selector', async () => {
  const store = new PlanStore(':memory:');
  try {
    const input = proposal(); input.scenarios[1].steps.at(-1).instruction = JSON.stringify({ kind: 'CLICK', target: { selector: 'button' } });
    const saved = approve(store, store.create(input));
    expect((await execute(store, saved)).outcome).toBe('PASS');
    const report = await execute(store, saved, { change: true });
    expect(report.outcome).toBe('BLOCKED'); expect(report.scenarios.every(item => !item.knowledgeMessage)).toBe(true);
    const result = contact(report), step = result.steps.find(item => item.kind === 'CLICK');
    expect(step.outcome).toBe('BLOCKED'); expect(step.message).toContain('no approved meaning');
    expect(result.knowledge.metrics.discoveryCalls).toBe(0); expect(result.knowledge.metrics.reusedSteps).toBe(2);
    expect(result.knowledge.findings).toHaveLength(1); expect(store.knowledge.list('contact-changed')[0].revisions[0].status).toBe('CANDIDATE');
  } finally { store.close(); }
});

test('Electron Knowledge view survives restart and opens original evidence', async () => {
  const data = folder + randomUUID() + '/'; mkdirSync(data);
  const store = new PlanStore(data + 'desktop-plans.sqlite');
  const a = approve(store, store.create(proposal())); await execute(store, a); await execute(store, a, { change: true }); store.close();
  const env = { ...process.env, QASPIDER_DESKTOP_DATA_DIR: data, QASPIDER_DESKTOP_PROVIDER: 'none' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
  try {
    const window = await app.firstWindow(), section = window.getByTestId('knowledge');
    await section.getByLabel('Search workflows').fill('contact-changed'); await section.getByRole('button', { name: 'Refresh knowledge' }).click();
    await expect(section.getByText('Unexpected application changes · human review required')).toBeVisible();
    await section.scrollIntoViewIfNeeded(); await window.screenshot({ path: folder + 'knowledge-view.png' });
    await section.getByText('Revision history and evidence (2)').click();
    await section.getByRole('button', { name: 'View original divergence evidence' }).click();
    await expect(section.getByAltText('Persisted workflow execution evidence')).toBeVisible();
    await section.screenshot({ path: folder + 'knowledge-evidence.png' });
  } finally { await app.close(); }
});
