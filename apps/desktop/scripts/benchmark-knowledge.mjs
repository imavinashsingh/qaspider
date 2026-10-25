import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PlanStore } from '../electron/plan-store.mjs';
import { ApprovedExecution } from '../electron/approved-execution.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';
import { openBrowserSession } from '../electron/browser.mjs';
import { CodexProvider } from '../electron/codex-provider.mjs';
import { knowledgeProposal } from '../tests/fixtures/knowledge-plan.mjs';
import { approve, executionIdentity, executionRequest } from '../tests/fixtures/approved-plan.mjs';

// Explicit real inference: synthetic owned DOM only, existing provider isolation gate,
// no mock fallback. Each pair uses identical commands, inputs and assertions.
const provider = new CodexProvider();
const folder = fileURLToPath(new URL('../../../test-results/desktop-live/m6/benchmark/', import.meta.url));
mkdirSync(folder, { recursive: true });
const runs = [], trials = 3;
const capability = await provider.prepare();
async function run(store, label, trial, { noMemory = false, change = false, defect = false } = {}) {
  const saved = approve(store, store.create(knowledgeProposal())), before = store.get(saved.planId);
  const service = new ApprovedExecution(store, { provider, options: { headless: true }, runner: (input, settings) => runGenericScenario(input, { ...settings, memory: noMemory ? null : settings.memory,
    openSession: async (...args) => {
      const session = await openBrowserSession(...args);
      if (input.id === 'S-2' && change) await session.controlledPage.locator('button').evaluate(node => { const replacement = node.cloneNode(true); replacement.textContent = 'Send request'; node.parentElement.replaceChildren(replacement); });
      if (input.id === 'S-2' && defect) await session.controlledPage.locator('form').evaluate(form => form.addEventListener('submit', () => { document.getElementById('result').textContent = 'Delivery failed'; }));
      return session;
    },
  }) });
  try {
    const start = performance.now(), report = await service.execute(executionRequest(saved, await service.prepare(executionIdentity(saved))));
    assert.equal(report.outcome, defect ? 'FAIL' : 'PASS', JSON.stringify(report.gaps));
    assert.deepEqual(store.get(saved.planId), before);
    assert.ok(report.scenarios.every(item => !item.knowledgeMessage), 'Knowledge persistence failed');
    const result = report.scenarios[1].result;
    const evidence = result.evidence.map(item => { const filename = `${trial}-${label}-${item.stepNumber}.png`; writeFileSync(folder + filename, Buffer.from(item.screenshot.split(',')[1], 'base64')); return { id: item.id, stepNumber: item.stepNumber, screenshot: 'test-results/desktop-live/m6/benchmark/' + filename }; });
    const measurement = { trial, label, executionId: report.id, outcome: report.outcome, wallMs: performance.now() - start, ...result.knowledge.metrics, unexpectedChanges: result.knowledge.findings.length, evidence };
    runs.push(measurement); console.log(JSON.stringify({ ...measurement, evidence: evidence.length }));
    return report;
  } finally { await service.close(); }
}
for (let trial = 1; trial <= trials; trial++) {
  const base = folder + randomUUID(); mkdirSync(base);
  const cold = new PlanStore(base + '/cold.sqlite');
  try { await run(cold, 'without-memory', trial, { noMemory: true }); } finally { cold.close(); }
  let store = new PlanStore(base + '/learned.sqlite');
  try {
    const a = await run(store, 'ticket-A', trial);
    store.close(); store = new PlanStore(base + '/learned.sqlite');
    const b = await run(store, 'ticket-B-after-restart', trial);
    assert.ok(a.scenarios[1].result.knowledge.metrics.aiCalls > b.scenarios[1].result.knowledge.metrics.aiCalls);
    if (trial === 1) {
      const changed = await run(store, 'UI-change', trial, { change: true });
      assert.equal(changed.scenarios[1].result.knowledge.findings.length, 1);
      await run(store, 'business-defect', trial, { change: true, defect: true });
      const workflow = store.knowledge.list('contact-changed')[0];
      assert.deepEqual(workflow.revisions.map(item => item.status), ['CANDIDATE', 'VERIFIED', 'VERIFIED']);
      writeFileSync(folder + 'revision-history.json', JSON.stringify(workflow, null, 2));
    }
  } finally { store.close(); }
}
const groups = ['without-memory', 'ticket-A', 'ticket-B-after-restart'].map(label => {
  const samples = runs.filter(run => run.label === label);
  const mean = field => samples.every(item => typeof item[field] === 'number') ? samples.reduce((sum, item) => sum + item[field], 0) / samples.length : null;
  return { label, samples: samples.length, meanAiCalls: mean('aiCalls'), meanTotalTokens: mean('totalTokens'), meanDiscoveryMs: mean('discoveryMs'), meanWallMs: mean('wallMs'), meanReusedSteps: mean('reusedSteps') };
});
writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m6-benchmark.json', import.meta.url)), JSON.stringify({ measuredAt: new Date().toISOString(), liveModelInference: true, realStagehandBrowser: true, controlledSyntheticDataOnly: true, provider: capability, trials, groups, runs, note: 'Contact scenario AI/token/discovery/reuse measurements; wall time includes both registration and contact scenarios, provider preparation, screenshots, persistence and cleanup. Unknown token metadata is null. Three serial samples are descriptive, not a statistical speed guarantee.' }, null, 2) + '\n');
