import { describe, expect, it, vi } from 'vitest';
import { captureTarget, validateTarget } from '../electron/browser.mjs';

function fixture(failure) {
  const page = {
    setViewportSize: vi.fn(async () => {}),
    goto: vi.fn(async () => { if (failure === 'navigation') throw new Error('Connection refused'); return { status: () => 200 }; }),
    url: vi.fn(async () => 'http://localhost:3000/login'),
    screenshot: vi.fn(async () => { if (failure === 'screenshot') throw new Error('Screenshot failed'); return Buffer.from('png'); }),
  };
  const browser = {
    context: { rpcClient: { browserWebSocketDebuggerUrl: 'ws://localhost:9222' }, pages: vi.fn(async () => [page]) },
    close: vi.fn(async () => {}),
  };
  const stagehand = { rpcClient: { browserWebSocketDebuggerUrl: 'ws://localhost:9222' }, close: vi.fn(async () => { if (failure === 'cleanup') throw new Error('Close failed'); }) };
  const network = { on: vi.fn(), send: vi.fn(async () => {}) };
  const dependencies = {
    localBrowser: { launch: vi.fn(async () => { if (failure === 'startup') throw new Error('Chrome missing'); return browser; }) },
    Stagehand: { create: vi.fn(async () => { if (failure === 'init') throw new Error('Init failed'); return stagehand; }) },
    chromium: { connectOverCDP: vi.fn(async () => ({ contexts: () => [{ pages: () => [page], newCDPSession: async () => network }] })) },
  };
  return { page, browser, stagehand, dependencies, network };
}

describe('desktop capture', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://name:secret@example.org', 'bad-url', null, 'x'.repeat(4097)])('rejects invalid input before startup: %s', async input => {
    const f = fixture();
    expect((await captureTarget(input, {}, f.dependencies)).status).toBe('error');
    expect(f.dependencies.localBrowser.launch).not.toHaveBeenCalled();
  });

  it('accepts local development URLs', () => {
    expect(validateTarget(' http://localhost:3000/login ').href).toBe('http://localhost:3000/login');
    expect(validateTarget('http://[::1]:3000').hostname).toBe('[::1]');
  });

  it('returns evidence with no model configuration and closes both resources', async () => {
    const f = fixture();
    const result = await captureTarget('http://localhost:3000/login', {}, f.dependencies);
    expect(result).toMatchObject({ status: 'success', visitedUrl: 'http://localhost:3000/login', screenshot: 'data:image/png;base64,cG5n' });
    expect(f.dependencies.Stagehand.create).toHaveBeenCalledWith({ browser: f.browser, cache: false, selfHeal: false });
    expect(f.stagehand.close).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });

  it.each(['startup', 'init', 'navigation', 'screenshot', 'cleanup'])('reports %s errors and releases acquired resources', async failure => {
    const f = fixture(failure);
    const result = await captureTarget('http://localhost:3000/login', {}, f.dependencies);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/startup|navigation|screenshot|Cleanup/);
    expect(f.browser.close).toHaveBeenCalledTimes(failure === 'startup' ? 0 : 1);
    expect(f.stagehand.close).toHaveBeenCalledTimes(['startup', 'init'].includes(failure) ? 0 : 1);
  });

  it('blocks requests outside the exact origin, including same-host different-port redirects', async () => {
    const f = fixture();
    await captureTarget('http://localhost:3000/login', {}, f.dependencies);
    const handler = f.network.on.mock.calls[0][1];
    for (const [url, allowed] of [['http://localhost:3000/style.css', true], ['http://localhost:3001/', false], ['https://localhost:3000/', false], ['https://example.org/', false]]) {
      handler({ request: { url }, requestId: 'request' });
      expect(f.network.send).toHaveBeenLastCalledWith(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: 'request', ...(allowed ? {} : { errorReason: 'BlockedByClient' }),
      });
    }
  });

  it('rejects an unexpected final origin', async () => {
    const f = fixture();
    f.page.url.mockResolvedValue('https://elsewhere.example/');
    expect((await captureTarget('http://localhost:3000', {}, f.dependencies)).status).toBe('error');
    expect(f.page.screenshot).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledOnce();
  });

  it('retains screenshot evidence for HTTP error pages', async () => {
    const f = fixture();
    f.page.goto.mockResolvedValue({ status: () => 503 });
    expect(await captureTarget('http://localhost:3000', {}, f.dependencies)).toMatchObject({ status: 'error', httpStatus: 503, screenshot: expect.stringContaining('data:image/png') });
  });
});
