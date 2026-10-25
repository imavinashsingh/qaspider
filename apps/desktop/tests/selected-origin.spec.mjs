import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { selectApplicationTarget } from '../electron/execution-target.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';

test('selected origins permit approved state changes but block form submission before a request', async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') submissions++;
    response.setHeader('content-type', 'text/html');
    response.end('<form method="post"><button type="button" onclick="document.querySelector(\'input\').disabled=false">Enable</button><input aria-label="Message" disabled><button>Submit</button></form>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const target = selectApplicationTarget(`http://127.0.0.1:${server.address().port}/arbitrary`);
  const settings = { fixture: target, authorized: true, options: { headless: true } };
  try {
    const report = await runGenericScenario({ id: 'selected', name: 'Selected application', steps: [
      { kind: 'NAVIGATE', path: '/arbitrary' },
      { kind: 'CLICK', target: { role: 'button', label: 'Enable' } },
      { kind: 'ASSERT_ENABLED', selector: 'input', expected: true },
    ] }, settings);
    expect(report.outcome).toBe('PASS'); expect(report.browserClosed).toBe(true);
    const blocked = await runGenericScenario({ id: 'submission', name: 'Blocked form submission', steps: [
      { kind: 'NAVIGATE', path: '/arbitrary' },
      { kind: 'CLICK', target: { role: 'button', label: 'Submit' } },
      { kind: 'ASSERT_ENABLED', selector: 'input', expected: true },
    ] }, settings);
    expect(blocked.outcome).toBe('BLOCKED');
    expect(blocked.steps[1].message).toContain('Form submission');
    expect(submissions).toBe(0);
    await target.close();
    const expired = await runGenericScenario({ id: 'expired', name: 'Expired selection', steps: [
      { kind: 'NAVIGATE', path: '/arbitrary' }, { kind: 'ASSERT_ENABLED', selector: 'input', expected: false },
    ] }, settings);
    expect(expired.outcome).toBe('BLOCKED'); expect(expired.browserClosed).toBe(false);
  } finally {
    await target.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
