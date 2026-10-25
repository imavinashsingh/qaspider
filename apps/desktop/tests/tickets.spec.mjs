import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { CodexProvider, sendSyntheticResponse } from '../electron/codex-provider.mjs';
import { TicketPlanner } from '../electron/ticket-planner.mjs';
import { registrationTicket, registrationDraft } from './fixtures/ticket.mjs';

let endpoint, planner, requests = 0, mode = 'valid';
test.beforeAll(async () => {
  endpoint = createServer(async (request, response) => {
    let body = ''; for await (const bytes of request) body += bytes;
    requests++;
    const input = JSON.parse(body);
    expect(input.tools ?? []).toEqual([]);
    expect(body).toContain('AC-1'); expect(body).toContain('Validate registration form');
    sendSyntheticResponse(response, mode === 'valid' ? registrationDraft() : { scenarios: [] });
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  planner = new TicketPlanner({ provider: new CodexProvider({ testEndpoint: `http://127.0.0.1:${endpoint.address().port}/v1` }) });
});
test.afterAll(async () => { endpoint.closeAllConnections(); await new Promise(resolve => endpoint.close(resolve)); });

test('real Codex CLI transport produces a validated draft from explicitly synthetic inference', async () => {
  mode = 'valid';
  const before = requests;
  const result = await planner.propose(registrationTicket);
  expect(result.status, result.message).toBe('proposed'); expect(requests).toBe(before + 1);
  expect(result.provider.synthetic).toBe(true);
  expect(result.plan.ticket.acceptanceCriteria).toHaveLength(3);
  expect(result.plan.scenarios).toHaveLength(5);
  expect(result.plan.status).toBe('draft'); expect(result.plan).not.toHaveProperty('outcome');
  expect(result.plan.scenarios.every(item => !('selector' in item) && !('outcome' in item))).toBe(true);
});
test('real CLI structured-output validation rejects invalid AI output without a fallback', async () => {
  mode = 'invalid';
  const result = await planner.propose(registrationTicket);
  expect(result.status).toBe('invalid-output'); expect(result).not.toHaveProperty('plan');
});
test('real Electron UI explains missing provider and rejects malformed tickets without a plan', async () => {
  const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'none' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
  try {
    const window = await app.firstWindow();
    const section = window.getByTestId('ticket-planning');
    await section.getByRole('button', { name: 'Propose test plan' }).click();
    await expect(section.getByTestId('ticket-plan-status')).toContainText('no compatible provider');
    await expect(section.getByTestId('ticket-plan')).toHaveCount(0);
    await section.getByLabel('Ticket title', { exact: true }).fill('   ');
    await section.getByRole('button', { name: 'Propose test plan' }).click();
    await expect(section.getByTestId('ticket-plan-status')).toContainText('Enter a title');
    await expect(section.getByRole('button', { name: /approve|execute|run/i })).toHaveCount(0);
  } finally { await app.close(); }
});
