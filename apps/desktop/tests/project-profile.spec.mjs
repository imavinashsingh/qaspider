import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const evidence = join(root, 'validation/vnext-project-foundation-evidence');

test('project profile, optional context, archive/restore and conversation survive an actual desktop restart', async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), 'qaspider-vnext-profile-ui-'));
  const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [join(root, 'apps/desktop')], env });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByLabel('New project name').fill('Clinic QA');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByText('Project profile', { exact: true }).click();
    await expect(page.getByTestId('onboarding-question')).toContainText('What does the application do?');
    await page.getByLabel('Project description', { exact: true }).fill('Appointment scheduling for clinics.');
    await page.getByRole('button', { name: 'Save project profile', exact: true }).click();
    await expect(page.getByTestId('onboarding-question')).toContainText('Which business domain');
    await page.getByRole('button', { name: 'Skip this optional question', exact: true }).click();
    await expect(page.getByTestId('onboarding-question')).toContainText('Which roles');
    await page.getByLabel('Project context note').fill('Receptionists and clinicians use this application.');
    await page.getByRole('button', { name: 'Save context note', exact: true }).click();
    await expect(page.getByLabel('Saved project context')).toContainText('Receptionists and clinicians');
    await expect(page.getByTestId('onboarding-question')).toContainText('Which development or QA environment');
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const projectId = await page.getByLabel('Project', { exact: true }).inputValue();
    const profile = (await page.evaluate(id => window.qaspider.projectProfile(id), projectId)).value;
    await page.getByLabel('QA request and expected results').fill('Unsaved private project A draft');
    await page.getByLabel('New project name').fill('Independent project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByLabel('Project', { exact: true }).locator('option:checked')).toHaveText('Independent project');
    const otherId = await page.getByLabel('Project', { exact: true }).inputValue();
    expect(otherId).not.toBe(projectId);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.getByLabel('QA request and expected results')).toHaveValue('');
    await expect(page.getByLabel('Saved project context')).toBeEmpty();
    await page.getByLabel('Project', { exact: true }).selectOption(projectId);
    await page.getByText('Project profile', { exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Clinic QA renamed');
    await page.getByRole('button', { name: 'Save project profile', exact: true }).click();
    await page.getByRole('button', { name: 'Archive project', exact: true }).click();
    await expect(page.getByLabel('Project', { exact: true }).locator('option:checked')).toContainText('(archived)');
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Restore project', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeEnabled();
    mkdirSync(evidence, { recursive: true });
    await page.getByText('Project profile', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'project-profile.png') });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.getByLabel('Project', { exact: true }).selectOption(projectId);
    await page.getByText('Project profile', { exact: true }).click();
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Clinic QA renamed');
    await expect(page.getByLabel('Project description', { exact: true })).toHaveValue('Appointment scheduling for clinics.');
    await expect(page.getByLabel('Saved project context')).toContainText('Receptionists and clinicians');
    await expect(page.getByTestId('onboarding-question')).toContainText('Which development or QA environment');
    await expect(page.getByRole('button', { name: 'QA conversation 1', exact: true })).toBeVisible();
    const restored = await page.evaluate(id => window.qaspider.projectProfile(id), projectId);
    const independent = await page.evaluate(id => window.qaspider.projectProfile(id), otherId);
    expect(restored.value.agentId).toBe(profile.agentId); expect(independent.value.notes).toEqual([]);
    await page.getByText('Project profile', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'project-profile-after-restart.png') });
    writeFileSync(join(evidence, 'receipt.json'), JSON.stringify({ mode: 'Real Electron UI; provider disabled; no model calls or browser test execution', projectId, agentId: profile.agentId,
      identityPreserved: true, profilePreserved: true, conversationsPreserved: true, skippedQuestionsPreserved: true, notesIsolated: true, unsavedComposerClearedOnSwitch: true,
      archiveRestore: true, screenshots: ['project-profile.png', 'project-profile-after-restart.png'] }, null, 2) + '\n');
  } finally { await app.close(); }
});
