import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Live inference on the fixed public example; automated review clicks are a
// synthetic walkthrough, not claims that real registration tests were run.
const ticket = { title: 'Validate registration form', description: 'Check registration using an email address.', acceptanceCriteria: ['Email is required.', 'Duplicate email addresses must be rejected.', 'Valid registration should succeed.'] };
const privatePath = `.qaspider/desktop-m42-live/${randomUUID()}`;
const dataDir = fileURLToPath(new URL('../../../' + privatePath, import.meta.url));
const evidence = fileURLToPath(new URL('../../../test-results/desktop-live/', import.meta.url));
mkdirSync(evidence, { recursive: true });
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 25_000 });
async function read(window, planId, revision) {
  const result = await window.evaluate(input => window.qaspider.getPlan(input), revision === undefined ? { planId } : { planId, revision });
  assert.equal(result.status, 'ok'); return result.value;
}
async function screenshot(window, name) {
  await window.getByTestId('revision-status').scrollIntoViewIfNeeded();
  await window.screenshot({ path: evidence + '/' + name });
}
let app;
try {
  app = await launch(); let window = await app.firstWindow(); let section = window.getByTestId('ticket-planning');
  await section.getByLabel('Ticket title', { exact: true }).fill(ticket.title);
  await section.getByLabel('Ticket description', { exact: true }).fill(ticket.description);
  await section.getByLabel('Acceptance criteria (one per line, up to 20)', { exact: true }).fill(ticket.acceptanceCriteria.join('\n'));
  await section.getByRole('button', { name: 'Propose test plan' }).click();
  await expect(section.getByTestId('ticket-plan-status')).toContainText('Draft proposal only', { timeout: 120_000 });
  await expect(section.getByTestId('revision-status')).toHaveText('Revision 1 · DRAFT');
  const plans = await window.evaluate(() => window.qaspider.listPlans()); assert.equal(plans.status, 'ok');
  const planId = plans.value[0].id, generated = await read(window, planId);
  assert(generated.coverage.every(item => item.scenarioIds.length > 0), 'Public example needs proposed scenarios for every criterion');
  const scenario = generated.content.scenarios[0], reviewedTitle = scenario.title + ' (human reviewed)';
  await section.getByRole('button', { name: `Edit ${scenario.id}`, exact: true }).click();
  await section.getByLabel('Scenario title', { exact: true }).fill(reviewedTitle);
  await section.getByLabel('Expected outcome 1', { exact: true }).fill(scenario.steps[0].expectedOutcome + ' Reviewed against the linked criterion.');
  await section.getByRole('button', { name: 'Save scenario changes' }).click();
  await expect(section.getByTestId('ticket-scenario').first()).toContainText('Human-edited');
  for (const item of generated.content.assumptions) {
    await section.getByLabel(`Decision for ${item.id}`, { exact: true }).selectOption('confirmed');
    await section.getByLabel(`Review note for ${item.id}`, { exact: true }).fill('Synthetic walkthrough: accepted as intended test setup for this proposal. This is not evidence of runtime fixture availability or authorization to execute.');
    await section.getByRole('button', { name: `Save decision for ${item.id}`, exact: true }).click();
    await expect(section.getByRole('button', { name: 'Start review', exact: true })).toBeEnabled();
  }
  await section.getByRole('button', { name: 'Start review', exact: true }).click();
  for (const item of generated.content.criteria) {
    await section.getByLabel(`Coverage review note for ${item.criterionId}`, { exact: true }).fill('Synthetic review demonstration: retained steps and conceptual assertions address this original criterion; nothing has been executed.');
    await section.getByRole('button', { name: `Confirm planned coverage for ${item.criterionId}`, exact: true }).click();
    await expect(section.getByRole('button', { name: `Clear coverage confirmation for ${item.criterionId}`, exact: true })).toBeVisible();
  }
  await section.getByRole('button', { name: 'Approve Plan', exact: true }).click();
  await expect(section.getByTestId('revision-status')).toHaveText('Revision 1 · APPROVED');
  const approved = await read(window, planId); assert.equal(approved.hash, approved.approvals[0].hash);
  await screenshot(window, 'm4.2-approved.png');
  await section.getByRole('button', { name: 'Create new DRAFT revision' }).click();
  await expect(section.getByTestId('revision-status')).toHaveText('Revision 2 · DRAFT');
  await section.getByRole('button', { name: `Edit ${scenario.id}`, exact: true }).click();
  await section.getByLabel('Scenario title', { exact: true }).fill(reviewedTitle + ' — revised');
  await section.getByRole('button', { name: 'Save scenario changes' }).click();
  await expect(section.getByTestId('ticket-scenario').first()).toContainText('— revised');
  await screenshot(window, 'm4.2-draft2.png');
  await app.close(); app = await launch(); window = await app.firstWindow(); section = window.getByTestId('ticket-planning');
  await expect(section.getByTestId('revision-status')).toHaveText('Revision 2 · DRAFT');
  const revision2 = await read(window, planId), revision1 = await read(window, planId, 1);
  assert.equal(revision1.hash, approved.hash); assert.deepEqual(revision1.content, approved.content);
  assert.equal(revision1.status, 'APPROVED'); assert.equal(revision2.status, 'DRAFT');
  assert.equal(revision2.approvals.length, 1); assert.equal(revision2.approvals[0].revision, 1);
  assert.deepEqual(revision2.original.ticket, generated.original.ticket);
  assert(revision2.coverage.every(item => item.executed === 'NOT_EXECUTED'));
  await section.getByLabel('Saved revision', { exact: true }).selectOption('1');
  await expect(section.getByTestId('revision-status')).toContainText('Revision 1 · APPROVED');
  await screenshot(window, 'm4.2-reopened1.png');
  const receipt = {
    verifiedAt: new Date().toISOString(), liveInference: true, syntheticTicketOnly: true,
    reviewActions: 'Automated UI interaction for a synthetic walkthrough', browserExecutionRequested: false,
    input: ticket, privateDatabase: privatePath + '/desktop-plans.sqlite', planId,
    generatedScenarios: generated.content.scenarios.length,
    revision1: { status: revision1.status, hash: revision1.hash, title: revision1.content.scenarios[0].title, approval: revision1.approvals[0], coverage: revision1.coverage },
    revision2: { status: revision2.status, hash: revision2.hash, title: revision2.content.scenarios[0].title, approvalInherited: false, coverage: revision2.coverage },
    restartVerified: true, approvedContentPreserved: true, originalCriteriaPreserved: true,
    screenshots: ['test-results/desktop-live/m4.2-approved.png', 'test-results/desktop-live/m4.2-draft2.png', 'test-results/desktop-live/m4.2-reopened1.png'],
  };
  writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m4.2-review.json', import.meta.url)), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', revision1: 'APPROVED', revision2: 'DRAFT', restartVerified: true, browserExecutionRequested: false }));
} finally { await app?.close(); }
