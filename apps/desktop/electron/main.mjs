import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { captureTarget } from './browser.mjs';
import { CodexProvider } from './codex-provider.mjs';
import { TestingWorkspace } from './workspace.mjs';
import { runScenarioSuite } from './scenario-runner.mjs';
import { TicketPlanner } from './ticket-planner.mjs';
import { PlanStore } from './plan-store.mjs';
import { ApprovedExecution } from './approved-execution.mjs';
import { join } from 'node:path';
import { z } from 'zod';
import { DesktopService } from './desktop-service.mjs';
import { isAbsolute } from 'node:path';
import { ProjectMainAgent } from './main-agent.mjs';

const uiUrl = new URL('../dist/index.html' + (process.env.QASPIDER_DESKTOP_LEGACY_UI === '1' ? '?legacy=1' : ''), import.meta.url).href;
let activeRun;
let operationStatus = { busy: false };
let quitting = false;
let allowQuit = false;
const browserOptions = { executablePath: process.env.CHROME_PATH, headless: process.env.QASPIDER_DESKTOP_HEADLESS === '1' };
let provider = (!process.env.QASPIDER_DESKTOP_PROVIDER || process.env.QASPIDER_DESKTOP_PROVIDER === 'codex') ? new CodexProvider() : null;
const workspace = new TestingWorkspace({ provider, options: browserOptions });
let ticketPlanner = new TicketPlanner({ provider });
let planStore;
let planExecution;
let projectAgent;
const agent = () => projectAgent ??= new ProjectMainAgent(savedPlans(), { provider: () => provider });
const savedPlans = () => planStore ??= new PlanStore(join(process.env.QASPIDER_DESKTOP_DATA_DIR ?? app.getPath('userData'), 'desktop-plans.sqlite'));
const executions = () => planExecution ??= new ApprovedExecution(savedPlans(), { options: browserOptions, provider });
const desktopService = () => new DesktopService(savedPlans(), { planner: ticketPlanner, provider, options: browserOptions, onProgress: phase => { operationStatus = { ...operationStatus, phase }; } });
const settingsSchema = z.object({ provider: z.enum(['codex', 'none']), model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/), headless: z.boolean(), chromePath: z.string().max(4096).refine(value => !value || isAbsolute(value), 'Use an absolute browser executable path.') }).strict();
let effectiveSettings;
function applySettings(input) {
  const settings = settingsSchema.parse(input);
  effectiveSettings = settings;
  // Explicit Node-side regression injection; renderer settings cannot configure endpoints.
  provider = settings.provider === 'codex' ? new CodexProvider({ model: settings.model, testEndpoint: process.env.QASPIDER_DESKTOP_TEST_ENDPOINT }) : null;
  ticketPlanner = new TicketPlanner({ provider }); workspace.provider = provider;
  browserOptions.headless = settings.headless; browserOptions.executablePath = settings.chromePath || undefined;
  return settings;
}
const executionReply = operation => async input => {
  try { return { status: 'ok', value: await operation(input) }; }
  catch { return { status: 'error', message: 'Execution request rejected. Reload the latest approved revision, prepare its application and authorize its exact origin.' }; }
};
const reviewReply = operation => async input => {
  try { return { status: 'ok', value: operation(input) }; }
  catch { return { status: 'error', message: 'Review request could not be saved or loaded. Reload the latest revision and check the review blockers.' }; }
};

function createWindow() {
  const window = new BrowserWindow({
    title: 'QASpider Desktop', width: 1100, height: 900, minWidth: 640, minHeight: 600,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadURL(uiUrl);
}

void app.whenReady().then(() => {
  const persistedSettings = savedPlans().db.prepare('SELECT settings_json FROM desktop_settings WHERE id=1').get();
  applySettings({ provider: provider ? 'codex' : 'none', model: process.env.QASPIDER_CODEX_MODEL ?? 'gpt-6.1-sol', headless: browserOptions.headless, chromePath: browserOptions.executablePath ?? '', ...(persistedSettings ? JSON.parse(persistedSettings.settings_json) : {}),
    ...(process.env.QASPIDER_DESKTOP_PROVIDER ? { provider: process.env.QASPIDER_DESKTOP_PROVIDER === 'codex' ? 'codex' : 'none' } : {}),
    ...(process.env.QASPIDER_DESKTOP_HEADLESS ? { headless: process.env.QASPIDER_DESKTOP_HEADLESS === '1' } : {}),
    ...(process.env.QASPIDER_CODEX_MODEL ? { model: process.env.QASPIDER_CODEX_MODEL } : {}),
    ...(process.env.CHROME_PATH ? { chromePath: process.env.CHROME_PATH } : {}),
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const handle = (channel, operation, readOnly = false) => ipcMain.handle(channel, async (event, input) => {
    if (quitting || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) {
      return { status: 'error', message: 'Request is not from the desktop application.' };
    }
    if (readOnly) return operation(input);
    if (channel === 'desktop:save-settings' && projectAgent?.busy) return { status: 'error', message: 'Wait for the Main Agent reply before changing provider settings.' };
    if (activeRun) return { status: 'error', message: operationStatus.channel === 'desktop:open-browser' ? 'A browser capture is already running.' : 'Another desktop operation is already running.' };
    operationStatus = { busy: true, channel, startedAt: new Date().toISOString() };
    activeRun = Promise.resolve().then(() => operation(input));
    try { return await activeRun; }
    finally { activeRun = undefined; operationStatus = { busy: false }; }
  });
  handle('desktop:operation-status', () => ({ status: 'ok', value: operationStatus }), true);
  const agentReply = operation => async input => {
    try { return { status: 'ok', value: await operation(input) }; }
    catch (error) {
      const safe = ['Conversation does not belong to this project.', 'Restore the project before sending a new message.', 'The Main Agent is replying. Wait for the current reply before sending another message.', 'Leave credentials, access tokens and secrets out of chat. Use test-data references instead.'];
      return { status: 'error', message: safe.includes(error.message) ? error.message : 'Main Agent request rejected. Select a current project conversation and check the message length.' };
    }
  };
  // Independent inference lane: these fixed operations cannot own or release browser resources.
  handle('desktop:agent-start', agentReply(input => agent().start(input)), true);
  handle('desktop:agent-send', agentReply(input => agent().send(input)), true);
  handle('desktop:agent-history', agentReply(input => agent().history(input)), true);
  handle('desktop:agent-status', agentReply(input => agent().status(input)), true);
  handle('desktop:projects', reviewReply(() => savedPlans().conversations.list()), true);
  handle('desktop:create-project', reviewReply(input => savedPlans().conversations.createProject(input)));
  handle('desktop:project-profile', reviewReply(input => savedPlans().conversations.profiles.get(input)), true);
  handle('desktop:update-project', reviewReply(input => savedPlans().conversations.profiles.mutate(input)));
  handle('desktop:create-conversation', reviewReply(input => savedPlans().conversations.create(input)));
  handle('desktop:conversation', reviewReply(input => savedPlans().conversations.get(input)), true);
  handle('desktop:report', reviewReply(input => savedPlans().executionReport(input)), true);
  handle('desktop:set-context', reviewReply(input => savedPlans().conversations.setContext(input)));
  handle('desktop:send-message', executionReply(input => desktopService().send(input)));
  handle('desktop:prepare-draft', async input => {
    try { await workspace.close(); return { status: 'ok', value: await desktopService().prepare(input) }; }
    catch { return { status: 'error', message: `Executable preparation could not complete during ${operationStatus.phase ?? 'validation'}. Check provider availability, page access and missing expectations. No business actions were executed.` }; }
  });
  handle('desktop:settings', () => ({ status: 'ok', value: effectiveSettings, synthetic: Boolean(process.env.QASPIDER_DESKTOP_TEST_ENDPOINT) }), true);
  handle('desktop:save-settings', executionReply(async input => {
    const settings = settingsSchema.parse(input);
    await workspace.close(); await planExecution?.close(); planExecution = undefined;
    savedPlans().db.prepare('INSERT INTO desktop_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json').run(JSON.stringify(settings));
    return applySettings(settings);
  }));
  handle('desktop:open-browser', async input => { await workspace.close(); return captureTarget(input, browserOptions); });
  handle('desktop:observe', input => workspace.observe(input));
  handle('desktop:execute', input => workspace.execute(input));
  handle('desktop:close-session', async () => { await workspace.close(); return { status: 'closed' }; });
  handle('desktop:run-scenarios', async input => { await workspace.close(); return runScenarioSuite(input, browserOptions); });
  handle('desktop:propose-ticket-plan', async input => {
    const result = await ticketPlanner.propose(input);
    if (result.status !== 'proposed') return result;
    try { return { ...result, review: savedPlans().create(result.plan) }; }
    catch { return { status: 'unavailable', message: 'The proposal could not be saved locally. No reviewable revision was created.' }; }
  });
  handle('desktop:list-plans', reviewReply(() => savedPlans().list()), true);
  handle('desktop:list-knowledge', reviewReply(input => savedPlans().knowledge.list(z.string().max(500).parse(input ?? ''))), true);
  handle('desktop:knowledge-evidence', reviewReply(input => {
    const request = z.object({ executionId: z.string().uuid(), scenarioId: z.string().max(100), evidenceId: z.string().max(200) }).strict().parse(input);
    const row = savedPlans().db.prepare('SELECT report_json FROM desktop_plan_executions WHERE id=?').get(request.executionId);
    const evidence = row && JSON.parse(row.report_json).scenarios.find(item => item.scenarioId === request.scenarioId)?.result?.evidence.find(item => item.id === request.evidenceId);
    if (!evidence) throw new Error('Evidence not found.');
    return evidence;
  }), true);
  handle('desktop:get-plan', reviewReply(input => {
    const request = z.object({ planId: z.string().uuid(), revision: z.number().int().positive().optional() }).strict().parse(input);
    return savedPlans().get(request.planId, request.revision);
  }), true);
  handle('desktop:review-plan', reviewReply(input => savedPlans().mutate(input)));
  handle('desktop:prepare-plan', executionReply(input => executions().prepare(input)));
  handle('desktop:execute-plan', executionReply(async input => { await workspace.close(); return executions().execute(input); }));
  // Read-only progress remains available while the serialized execution is active.
  ipcMain.handle('desktop:plan-reports', async (event, input) => {
    if (quitting || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) return { status: 'error', message: 'Invalid desktop frame.' };
    return executionReply(value => {
      const request = z.object({ planId: z.string().uuid(), revision: z.number().int().positive() }).strict().parse(value);
      return savedPlans().executions(request.planId, request.revision);
    })(input);
  });
  createWindow();
  app.on('activate', () => { if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Wait for the bounded capture and its finally block before allowing app exit.
  app.on('before-quit', (event) => {
    if (allowQuit || (!activeRun && !workspace.hasSession && !planExecution?.pending && !projectAgent?.busy)) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const agentClosing = projectAgent?.close();
    void Promise.allSettled([Promise.resolve(activeRun), agentClosing]).then(() => workspace.close()).then(() => planExecution?.close()).catch(() => {}).finally(() => { allowQuit = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { void projectAgent?.close(); planStore?.close(); });
});
