import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { captureTarget } from './browser.mjs';
import { CodexProvider } from './codex-provider.mjs';
import { TestingWorkspace } from './workspace.mjs';
import { runScenarioSuite } from './scenario-runner.mjs';

const uiUrl = new URL('../dist/index.html', import.meta.url).href;
let activeRun;
let quitting = false;
let allowQuit = false;
const browserOptions = { executablePath: process.env.CHROME_PATH, headless: process.env.QASPIDER_DESKTOP_HEADLESS === '1' };
const provider = (!process.env.QASPIDER_DESKTOP_PROVIDER || process.env.QASPIDER_DESKTOP_PROVIDER === 'codex') ? new CodexProvider() : null;
const workspace = new TestingWorkspace({ provider, options: browserOptions });

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
  createWindow();
  app.on('activate', () => { if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Wait for the bounded capture and its finally block before allowing app exit.
  app.on('before-quit', (event) => {
    if (allowQuit || (!activeRun && !workspace.hasSession)) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void Promise.resolve(activeRun).catch(() => {}).then(() => workspace.close()).catch(() => {}).finally(() => { allowQuit = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
});
