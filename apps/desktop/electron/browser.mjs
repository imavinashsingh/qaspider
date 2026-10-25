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
 * A single local browser session. Callers must close it; startup failures close
 * partially acquired resources here. Shared by capture and observation.
 * @param {unknown} input
 * @param {{headless?: boolean, executablePath?: string | undefined, model?: import('@browserbasehq/stagehand').ClientLLM}} options
 * @param {{localBrowser: typeof localBrowser, Stagehand: typeof Stagehand, chromium: typeof chromium}} dependencies
 */
export async function openBrowserSession(input, options = {}, dependencies = { localBrowser, Stagehand, chromium }) {
  /** @type {import('@browserbasehq/stagehand').StagehandBrowser | undefined} */
  let browser;
  /** @type {import('@browserbasehq/stagehand').Stagehand | undefined} */
  let stagehand;
  let phase = 'validation';
  let closing;
  const close = () => closing ??= (async () => {
    const errors = [];
    try { await stagehand?.close(); } catch { errors.push('Stagehand session'); }
    try { await browser?.close(); } catch { errors.push('Chromium browser'); }
    if (errors.length) throw new Error('Cleanup failed: ' + errors.join(', '));
  })();
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
    stagehand = await dependencies.Stagehand.create({ browser, cache: false, selfHeal: false, logging: { level: 'off' }, ...(options.model ? { model: options.model } : {}) });
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
    let navigationFailure = '';
    let failedNavigationOrigin = '';
    controlledPage.on('requestfailed', request => {
      if (request.isNavigationRequest() && request.frame() === controlledPage.mainFrame()) {
        navigationFailure = request.failure()?.errorText ?? 'Navigation request failed';
        failedNavigationOrigin = new URL(request.url()).origin;
      }
    });
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
    // Stagehand can return null instead of throwing when Chromium displays its
    // internal error document. That document is not an application redirect.
    if (navigationFailure || visitedUrl.startsWith('chrome-error:') || visitedUrl === 'about:blank') {
      if (failedNavigationOrigin && failedNavigationOrigin !== target.origin) {
        throw new Error(`Navigation to ${failedNavigationOrigin} was blocked. Allowed origin: ${target.origin}. Enter the intended final application URL to explicitly choose its origin.`);
      }
      const hint = navigationFailure.includes('ERR_CONNECTION_REFUSED')
        ? 'Start the development application and check its port, then retry.'
        : 'Check that the application is running and the URL is reachable, then retry.';
      throw new Error(`Could not load ${target.origin}${navigationFailure ? ` (${navigationFailure})` : ''}. ${hint}`);
    }
    if (new URL(visitedUrl).origin !== target.origin) {
      throw new Error(`The page reached origin ${new URL(visitedUrl).origin}; allowed origin: ${target.origin}. Enter the intended final application URL to explicitly choose its origin.`);
    }
    return { target, browser, stagehand, page, controlledPage, context, network, response, close,
      screenshot: async () => 'data:image/png;base64,' + Buffer.from(await page.screenshot({ type: 'png', fullPage: false, timeout: 10_000 })).toString('base64') };
  } catch (error) {
    let cleanup = '';
    try { await close(); } catch (cause) { cleanup = ' ' + String(cause); }
    throw new Error(`${phase}: ${error instanceof Error ? error.message : 'Unexpected browser error'}${cleanup}`);
  }
}

/**
 * Milestone 1 capture remains model-free.
 * @param {unknown} input
 * @param {{headless?: boolean, executablePath?: string | undefined}} options
 * @param {{localBrowser: typeof localBrowser, Stagehand: typeof Stagehand, chromium: typeof chromium}} dependencies
 */
export async function captureTarget(input, options = {}, dependencies = { localBrowser, Stagehand, chromium }) {
  let session;
  /** @type {import('../src/main.tsx').CaptureResult | undefined} */
  let result;
  try {
    session = await openBrowserSession(input, options, dependencies);
    const visitedUrl = await session.page.url();
    const httpStatus = session.response?.status() ?? null;
    result = {
      status: httpStatus !== null && httpStatus >= 400 ? 'error' : 'success', visitedUrl, httpStatus,
      screenshot: await session.screenshot(),
      message: httpStatus !== null && httpStatus >= 400 ? `Application returned HTTP ${httpStatus}.` : 'Page captured.',
    };
  } catch (error) {
    result = { status: 'error', message: (session ? 'screenshot: ' : '') + (error instanceof Error ? error.message : 'Unexpected browser error') };
  } finally {
    try { await session?.close(); }
    catch (error) { result = { ...result, status: 'error', message: `${result?.message ?? ''} ${String(error)}` }; }
  }
  return result ?? { status: 'error', message: 'Capture did not produce a result.' };
}
