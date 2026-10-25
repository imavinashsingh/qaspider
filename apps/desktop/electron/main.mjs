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

const uiUrl = new URL('../dist/index.html', import.meta.url).href;
let activeRun;
let quitting = false;
let allowQuit = false;
const browserOptions = { executablePath: process.env.CHROME_PATH, headless: process.env.QASPIDER_DESKTOP_HEADLESS === '1' };
const provider = (!process.env.QASPIDER_DESKTOP_PROVIDER || process.env.QASPIDER_DESKTOP_PROVIDER === 'codex') ? new CodexProvider() : null;
const workspace = new TestingWorkspace({ provider, options: browserOptions });
const ticketPlanner = new TicketPlanner({ provider });
let planStore;
let planExecution;
const savedPlans = () => planStore ??= new PlanStore(join(process.env.QASPIDER_DESKTOP_DATA_DIR ?? app.getPath('userData'), 'desktop-plans.sqlite'));
const executions = () => planExecution ??= new ApprovedExecution(savedPlans(), { options: browserOptions, provider });
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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, input) => {
    if (quitting || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) {
      return { status: 'error', message: 'Request is not from the desktop application.' };
    }
    if (activeRun) return { status: 'error', message: 'A browser capture is already running.' };
    activeRun = operation(input);
    try { return await activeRun; }
    finally { activeRun = undefined; }
  });
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
  handle('desktop:list-plans', reviewReply(() => savedPlans().list()));
  handle('desktop:list-knowledge', reviewReply(input => savedPlans().knowledge.list(z.string().max(500).parse(input ?? ''))));
  handle('desktop:knowledge-evidence', reviewReply(input => {
    const request = z.object({ executionId: z.string().uuid(), scenarioId: z.string().max(100), evidenceId: z.string().max(200) }).strict().parse(input);
    const row = savedPlans().db.prepare('SELECT report_json FROM desktop_plan_executions WHERE id=?').get(request.executionId);
    const evidence = row && JSON.parse(row.report_json).scenarios.find(item => item.scenarioId === request.scenarioId)?.result?.evidence.find(item => item.id === request.evidenceId);
    if (!evidence) throw new Error('Evidence not found.');
    return evidence;
  }));
  handle('desktop:get-plan', reviewReply(input => {
    const request = z.object({ planId: z.string().uuid(), revision: z.number().int().positive().optional() }).strict().parse(input);
    return savedPlans().get(request.planId, request.revision);
  }));
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
    if (allowQuit || (!activeRun && !workspace.hasSession && !planExecution?.pending)) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void Promise.resolve(activeRun).catch(() => {}).then(() => workspace.close()).then(() => planExecution?.close()).catch(() => {}).finally(() => { allowQuit = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { planStore?.close(); });
});
