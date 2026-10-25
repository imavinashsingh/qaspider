import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { parseTicket, validateTicketPlan } from '../shared/ticket-plan.mjs';

// Explicit opt-in live inference, only the public synthetic registration example.
const ticket = { title: 'Validate registration form', description: 'Check registration using an email address.', acceptanceCriteria: ['Email is required.', 'Duplicate email addresses must be rejected.', 'Valid registration should succeed.'] };
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'codex' }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 25_000 });
  const window = await app.firstWindow();
  const section = window.getByTestId('ticket-planning');
  await section.getByLabel('Ticket title', { exact: true }).fill(ticket.title);
  await section.getByLabel('Ticket description', { exact: true }).fill(ticket.description);
  await section.getByLabel('Acceptance criteria (one per line, up to 20)', { exact: true }).fill(ticket.acceptanceCriteria.join('\n'));
  await section.getByRole('button', { name: 'Propose test plan' }).click();
  await expect(section.getByTestId('ticket-plan-status')).toContainText('Draft proposal only', { timeout: 120_000 });
  const plan = JSON.parse(await section.getByTestId('ticket-plan-json').textContent());
  const { version, status, proposalSource, ticket: source, ...draft } = plan;
  assert.deepEqual(validateTicketPlan(parseTicket(ticket), draft), plan);
  assert.deepEqual(source, parseTicket(ticket)); assert.equal(status, 'draft');
  for (const category of ['positive', 'negative', 'boundary']) assert(plan.scenarios.some(item => item.category === category), 'Expected registration category: ' + category);
  for (const criterion of source.acceptanceCriteria) assert(plan.scenarios.some(item => item.criterionId === criterion.id), 'Example criterion must have a conceptual scenario: ' + criterion.id);
  assert(plan.scenarios.every(item => item.assertions.every(assertion => assertion.exactValue === null)), 'Example specifies no exact assertion values');
  await expect(section.getByTestId('ticket-scenario')).toHaveCount(plan.scenarios.length);
  await expect(section.getByText('Unspecified in ticket', { exact: true }).first()).toBeVisible();
  await expect(section.getByRole('button', { name: /approve|execute|run/i })).toHaveCount(0);
  const directory = fileURLToPath(new URL('../../../test-results/desktop-live/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  await section.screenshot({ path: directory + '/m4.1-ticket.png' });
  const receipt = { verifiedAt: new Date().toISOString(), provider: 'codex-cli', liveInference: true, syntheticTicketOnly: true, displayedInDesktop: true, executionRequested: false, screenshot: 'test-results/desktop-live/m4.1-ticket.png', input: ticket, plan };
  writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m4.1-ticket.json', import.meta.url)), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', scenarios: plan.scenarios.length, liveInference: true, executionRequested: false, receipt: 'validation/desktop-m4.1-ticket.json' }));
} finally { await app?.close(); }
