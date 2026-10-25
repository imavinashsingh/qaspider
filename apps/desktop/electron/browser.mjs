import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import { chromium } from 'playwright';

/** @param {unknown} input */
export function validateTarget(input) {
  if (typeof input !== 'string' || input.length > 4096) {
    throw new Error('Enter an HTTP or HTTPS application URL (maximum 4096 characters).');
  }
  let target;
  try { target = new URL(input.trim()); }
  catch { throw new Error('Enter a complete URL, for example http://localhost:3000.'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Use HTTP or HTTPS without embedded credentials.');
  }
  return target;
}

/**
 * One short capture session, with framework-owned browser startup and teardown.
 * @param {unknown} input
 * @param {{headless?: boolean, executablePath?: string | undefined}} options
 * @param {{localBrowser: typeof localBrowser, Stagehand: typeof Stagehand, chromium: typeof chromium}} dependencies
 */
export async function captureTarget(input, options = {}, dependencies = { localBrowser, Stagehand, chromium }) {
  /** @type {import('@browserbasehq/stagehand').StagehandBrowser | undefined} */
  let browser;
  let stagehand;
  let phase = 'validation';
  /** @type {import('../src/main.tsx').CaptureResult | undefined} */
  let result;
  try {
    const target = validateTarget(input);
    phase = 'browser startup';
    const headless = options.headless ?? false;
    browser = await dependencies.localBrowser.launch({
      headless,
      // Chrome's native Linux theme integration can abort on missing GTK
      // font-setting schemas. Its built-in fallback keeps visible launches
      // independent of those desktop schemas without changing the sandbox.
      ...(process.platform === 'linux' && !headless ? { args: ['--ui-toolkit=fallback'] } : {}),
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
    // No model configuration: ordinary browser methods make no inference calls.
    stagehand = await dependencies.Stagehand.create({ browser, cache: false, selfHeal: false });
    phase = 'navigation';
    // Stagehand 4.3 domain policies reject localhost. Playwright supplies a CDP
    // session so Chromium checks every request, including each redirect hop.
    // This capture scope rule is not an OS/network security sandbox.
    const cdpUrl = stagehand.rpcClient?.browserWebSocketDebuggerUrl;
    if (!cdpUrl) throw new Error('Stagehand did not expose the local browser connection.');
    const connection = await dependencies.chromium.connectOverCDP(cdpUrl);
    const context = connection.contexts()[0];
    if (!context) throw new Error('Local browser context is unavailable.');
    const controlledPage = context.pages()[0];
    if (!controlledPage) throw new Error('Local browser page is unavailable.');
    const network = await context.newCDPSession(controlledPage);
    network.on('Fetch.requestPaused', event => {
      const allowed = new URL(event.request.url).origin === target.origin;
      const decision = allowed
        ? network.send('Fetch.continueRequest', { requestId: event.requestId })
        : network.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      // Fail closed if Chromium cannot apply the scope rule. A disconnect during
      // normal cleanup is harmless; close() is idempotent in Stagehand.
      void decision.catch(() => { void browser?.close().catch(() => {}); });
    });
    await network.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const page = (await browser.context.pages())[0] ?? await browser.context.newPage();
    // Visible window decorations otherwise reduce the actual page viewport.
    await page.setViewportSize(1280, 800);
    const response = await page.goto(target.href, { waitUntil: 'load', timeout: 20_000 });
    const visitedUrl = await page.url();
    if (new URL(visitedUrl).origin !== target.origin) {
      throw new Error('The page left the entered application origin.');
    }
    phase = 'screenshot';
    const screenshot = await page.screenshot({ type: 'png', fullPage: false, timeout: 10_000 });
    const httpStatus = response?.status() ?? null;
    result = {
      status: httpStatus !== null && httpStatus >= 400 ? 'error' : 'success',
      visitedUrl,
      httpStatus,
      screenshot: `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`,
      message: httpStatus !== null && httpStatus >= 400
        ? `Application returned HTTP ${httpStatus}.`
        : 'Page captured.',
    };
  } catch (error) {
    result = { status: 'error', message: `${phase}: ${error instanceof Error ? error.message : 'Unexpected browser error'}` };
  } finally {
    // Try both releases even when initialization or the first close failed.
    const errors = [];
    try { await stagehand?.close(); } catch { errors.push('Stagehand session'); }
    try { await browser?.close(); } catch { errors.push('Chromium browser'); }
    if (errors.length) {
      result = { ...result, status: 'error', message: `${result?.message ?? ''} Cleanup failed: ${errors.join(', ')}. Close any remaining browser window.` };
    }
  }
  return result ?? { status: 'error', message: 'Capture did not produce a result.' };
}
