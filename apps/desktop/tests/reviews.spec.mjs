import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanStore } from '../electron/plan-store.mjs';
import { parseTicket, validateTicketPlan } from '../shared/ticket-plan.mjs';
import { registrationTicket, registrationDraft } from './fixtures/ticket.mjs';

async function launch(folder) {
  const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_DATA_DIR: folder };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
}
test('real desktop reviews, approves, forks and retrieves both revisions after restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'qaspider-review-smoke-'));
  const store = new PlanStore(join(folder, 'desktop-plans.sqlite'));
  const generated = store.create(validateTicketPlan(parseTicket(registrationTicket), registrationDraft())); store.close();
  let app;
  try {
    app = await launch(folder); let window = await app.firstWindow(); let section = window.getByTestId('ticket-planning');
    await expect(section.getByTestId('revision-status')).toHaveText('Revision 1 · DRAFT');
    await section.getByRole('button', { name: 'Edit S-1', exact: true }).click();
    await section.getByLabel('Scenario title', { exact: true }).fill('Human-reviewed registration email');
    await section.getByLabel('Expected outcome 1', { exact: true }).fill('The supplied email satisfies the stated required-field condition.');
    await section.getByRole('button', { name: 'Save scenario changes' }).click();
    await expect(section.getByTestId('ticket-scenario').first()).toContainText('Human-edited');
    await expect(section.getByTestId('ticket-scenario').first()).toContainText('Email is required.');
    await section.getByLabel('Decision for AS-1', { exact: true }).selectOption('confirmed');
    await section.getByLabel('Review note for AS-1', { exact: true }).fill('Controlled synthetic fixture and email records verified by the reviewer.');
    await section.getByRole('button', { name: 'Save decision for AS-1', exact: true }).click();
    await expect(section.getByText('AI-generated assumption · Saved decision: confirmed', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Start review', exact: true }).click();
    await expect(section.getByRole('button', { name: 'Approve Plan', exact: true })).toBeDisabled();
    for (const id of ['AC-1', 'AC-2', 'AC-3']) {
      await section.getByLabel(`Coverage review note for ${id}`, { exact: true }).fill('Reviewed the retained scenario steps and final assertions against the original acceptance criterion.');
      await section.getByRole('button', { name: `Confirm planned coverage for ${id}`, exact: true }).click();
      await expect(section.getByRole('button', { name: `Clear coverage confirmation for ${id}`, exact: true })).toBeVisible();
    }
    await section.getByRole('button', { name: 'Approve Plan', exact: true }).click();
    await expect(section.getByTestId('revision-status')).toHaveText('Revision 1 · APPROVED');
    await expect(section.getByRole('button', { name: 'Edit S-1', exact: true })).toBeDisabled();
    await section.screenshot({ path: '../../test-results/desktop-m4.2-approved.png' });
    await section.getByRole('button', { name: 'Create new DRAFT revision' }).click();
    await expect(section.getByTestId('revision-status')).toHaveText('Revision 2 · DRAFT');
    await section.getByRole('button', { name: 'Edit S-1', exact: true }).click();
    await section.getByLabel('Scenario title', { exact: true }).fill('Revision two revised email scenario');
    await section.getByRole('button', { name: 'Save scenario changes' }).click();
    await expect(section.getByText('Revision two revised email scenario', { exact: false }).first()).toBeVisible();
    await section.screenshot({ path: '../../test-results/desktop-m4.2-revision2.png' });
    await app.close(); app = await launch(folder); window = await app.firstWindow(); section = window.getByTestId('ticket-planning');
    await expect(section.getByTestId('revision-status')).toHaveText('Revision 2 · DRAFT');
    await expect(section.getByTestId('ticket-scenario').first()).toContainText('Revision two revised email scenario');
    await section.getByLabel('Saved revision', { exact: true }).selectOption('1');
    await expect(section.getByTestId('revision-status')).toContainText('Revision 1 · APPROVED');
    await expect(section.getByTestId('ticket-scenario').first()).toContainText('Human-reviewed registration email');
    await expect(section.getByTestId('ticket-scenario').first()).not.toContainText('Revision two');
    const response = await window.evaluate(planId => window.qaspider.getPlan({ planId, revision: 1 }), generated.planId);
    expect(response.status).toBe('ok');
    expect(response.value.approvals[0].hash).toBe(response.value.hash);
    expect(response.value.coverage.every(item => item.executed === 'NOT_EXECUTED')).toBe(true);
    await expect(section.getByRole('button', { name: /execute|run tests/i })).toHaveCount(0);
  } finally { await app?.close(); rmSync(folder, { recursive: true, force: true }); }
});
