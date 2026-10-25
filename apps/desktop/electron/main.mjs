import { app, BrowserWindow, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { captureTarget } from './browser.mjs';

const uiUrl = new URL('../dist/index.html', import.meta.url).href;
let activeRun;
let quitting = false;

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
  ipcMain.handle('desktop:open-browser', async (event, input) => {
    if (quitting || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== uiUrl) {
      return { status: 'error', message: 'Request is not from the desktop application.' };
    }
    if (activeRun) return { status: 'error', message: 'A browser capture is already running.' };
    activeRun = captureTarget(input, {
      executablePath: process.env.CHROME_PATH,
      headless: process.env.QASPIDER_DESKTOP_HEADLESS === '1',
    });
    try { return await activeRun; }
    finally { activeRun = undefined; }
  });
  createWindow();
  app.on('activate', () => { if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Wait for the bounded capture and its finally block before allowing app exit.
  app.on('before-quit', (event) => {
    if (!activeRun) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void activeRun.finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
});
