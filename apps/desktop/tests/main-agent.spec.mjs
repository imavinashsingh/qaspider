import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendSyntheticResponse } from '../electron/codex-provider.mjs';
import { seedMainAgentData } from './fixtures/main-agent-data.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const folder = join(root, 'test-results/desktop-live/main-agent-synthetic');
const strings = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(strings).join('\n') : value && typeof value === 'object' ? Object.values(value).map(strings).join('\n') : '';
function agentPayload(value) {
  if (typeof value === 'string' && value.includes('{"systemPrompt":')) {
    try { const outer = JSON.parse(value.slice(value.indexOf('{"systemPrompt":'))); return JSON.parse(outer.messages[0].content[0].text); } catch {}
  }
  if (value && typeof value === 'object') for (const item of Object.values(value)) { const found = agentPayload(item); if (found) return found; }
}

test('Main Agent uses scoped stored records, survives restart, and coexists with real browser work', async () => {
  test.setTimeout(180000);
  const data = mkdtempSync(join(tmpdir(), 'qaspider-main-agent-electron-'));
  const seeded = await seedMainAgentData(join(data, 'desktop-plans.sqlite'));
  let hold = false, releaseModel, modelEntered, browserEntered, releaseBrowser;
  const modelReady = new Promise(resolve => { modelEntered = resolve; });
  const browserReady = new Promise(resolve => { browserEntered = resolve; });
  const requests = [];
  const endpoint = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const wire = JSON.parse(body), prompt = strings(wire.input), input = agentPayload(wire.input); requests.push(prompt);
    expect(wire.tools ?? []).toEqual([]);
    if (hold) { hold = false; modelEntered(); await new Promise(resolve => { releaseModel = resolve; }); }
    if (input?.toolResults) {
      sendSyntheticResponse(response, { reply: 'The saved QA execution passed both scenarios with actual assertion and screenshot evidence. A registration workflow is stored for this project.', sourceIds: [`report:${seeded.reportId}`, `workflow:${seeded.workflowRevisionId}`] });
    } else if (input?.userMessage.includes('Show saved QA')) {
      sendSyntheticResponse(response, { reply: 'I will read the saved records.', sourceIds: [], calls: [{ kind: 'list_qa', planId: null, reportId: null, query: null }, { kind: 'read_report', planId: seeded.planId, reportId: seeded.reportId, query: null }, { kind: 'search_knowledge', planId: null, reportId: null, query: 'registration' }] });
    } else {
      const isB = prompt.includes('COBALT-713');
      expect(prompt).not.toContain(isB ? 'AMBER-482' : 'COBALT-713');
      sendSyntheticResponse(response, { reply: isB ? 'Inventory Beta tracks warehouse stock. I have no Clinic Alpha project context in this conversation.' : 'Clinic Alpha schedules outpatient visits. Receptionists schedule visits according to your project notes.', sourceIds: [`project:${isB ? seeded.projectB.projectId : seeded.projectA.projectId}`], calls: [] });
    }
  });
  const website = createServer(async (request, response) => { if (request.url !== '/') { response.writeHead(204); response.end(); return; } browserEntered(); await new Promise(resolve => { releaseBrowser = resolve; }); response.end('<!doctype html><title>Owned status concurrency fixture</title><h1>Browser capture available</h1>'); });
  await Promise.all([new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve)), new Promise(resolve => website.listen(0, '127.0.0.1', resolve))]);
  const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: data, QASPIDER_DESKTOP_TEST_ENDPOINT: `http://127.0.0.1:${endpoint.address().port}/v1` };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = provider => electron.launch({ args: [join(root, 'apps/desktop')], env: { ...env, QASPIDER_DESKTOP_PROVIDER: provider } });
  let app = await launch('codex');
  try {
    let page = await app.firstWindow();
    const open = async scope => { await page.getByLabel('Project', { exact: true }).selectOption(scope.projectId); await page.getByRole('button', { name: 'Main Agent', exact: true }).click(); await expect(page.getByTestId('main-agent-chat')).toBeVisible(); };
    const send = async text => { await page.getByLabel('Message Main Agent').fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); };
    await open(seeded.projectA); await send('Describe this project.');
    await expect(page.getByTestId('agent-turn').last()).toContainText('Receptionists schedule visits');
    await send('Show saved QA, inspect the report and find registration knowledge.');
    await expect(page.getByTestId('agent-turn').last()).toContainText('actual assertion and screenshot evidence');
    await page.getByTestId('agent-turn').last().getByText('Sources (2)', { exact: true }).click();
    await expect(page.getByTestId('agent-turn').last()).toContainText(seeded.reportId);
    await expect(page.getByTestId('agent-turn').last()).toContainText(seeded.workflowRevisionId);
    const thread = (await page.evaluate(scope => window.qaspider.agentHistory(scope), seeded.projectA)).value.threadId;
    const wrong = await page.evaluate(scope => window.qaspider.agentHistory(scope), { projectId: seeded.projectB.projectId, conversationId: seeded.projectA.conversationId }); expect(wrong.status).toBe('error');
    hold = true; await send('Continue discussing the current project context.'); await modelReady;
    const capture = page.evaluate(url => window.qaspider.openBrowser(url), `http://127.0.0.1:${website.address().port}/`).catch(error => ({ status: 'error', message: error.message })); await browserReady;
    const start = performance.now();
    const state = await page.evaluate(async scope => ({ agent: await window.qaspider.agentStatus(scope), browser: await window.qaspider.operationStatus(), settings: await window.qaspider.settings() }), seeded.projectA);
    expect(performance.now() - start).toBeLessThan(2000); expect(state.agent.value.busy).toBe(true); expect(state.browser.value.busy).toBe(true); expect(state.settings.status).toBe('ok');
    const changed = await page.evaluate(settings => window.qaspider.saveSettings(settings), state.settings.value); expect(changed.status).toBe('error');
    releaseModel(); await expect(page.getByTestId('agent-turn').last()).toContainText('Receptionists schedule visits');
    expect((await page.evaluate(() => window.qaspider.operationStatus())).value.busy).toBe(true);
    releaseBrowser(); expect((await capture).status).toBe('success');
    mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, 'agent-and-sources.png') });
    await app.close(); app = await launch('codex'); page = await app.firstWindow(); await open(seeded.projectA);
    await expect(page.getByTestId('agent-turn')).toHaveCount(3);
    expect((await page.evaluate(scope => window.qaspider.agentHistory(scope), seeded.projectA)).value.threadId).toBe(thread);
    await send('What do we know after restart?'); await expect(page.getByTestId('agent-turn').last()).toContainText('Receptionists schedule visits');
    await page.screenshot({ path: join(folder, 'agent-after-restart.png') });
    await open(seeded.projectB); await send('What do you know about this project?'); await expect(page.getByTestId('agent-turn').last()).toContainText('Inventory Beta');
    const b = (await page.evaluate(scope => window.qaspider.agentHistory(scope), seeded.projectB)).value;
    expect(b.turns).toHaveLength(1); expect(JSON.stringify(b)).not.toContain('AMBER-482');
    await app.close(); app = await launch('none'); page = await app.firstWindow(); await open(seeded.projectA);
    await send('Explain provider availability.'); await expect(page.getByTestId('agent-turn').last()).toContainText('no compatible provider is configured');
    await page.getByLabel('Message Main Agent').fill('password: PRIVATE_LEAK_CANARY'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Leave credentials');
    expect(JSON.stringify((await page.evaluate(scope => window.qaspider.agentHistory(scope), seeded.projectA)).value)).not.toContain('PRIVATE_LEAK_CANARY');
    writeFileSync(join(folder, 'receipt.json'), JSON.stringify({ mode: 'Synthetic model responses; real Codex CLI isolation/transport, LangGraph, SQLite, Electron and owned browser execution', seeded, threadId: thread, modelRequests: requests.length, projectIsolation: true, restartPreserved: true, readOnlyToolsReturnedStoredData: true, concurrentBrowserAndChatStatus: true, missingProviderHonest: true, credentialsRejected: true }, null, 2));
  } finally {
    releaseModel?.(); releaseBrowser?.(); await app.close();
    endpoint.closeAllConnections(); website.closeAllConnections(); await Promise.all([new Promise(resolve => endpoint.close(resolve)), new Promise(resolve => website.close(resolve))]);
  }
});
