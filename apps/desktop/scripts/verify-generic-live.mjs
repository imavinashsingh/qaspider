import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CodexProvider } from '../electron/codex-provider.mjs';
import { startControlledFixture } from '../electron/controlled-fixture.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';
import { plan, navigate, fill, click, check } from '../tests/fixtures/generic-plan.mjs';

// Explicit live inference using the existing isolated Codex provider and synthetic DOM only.
const fixture = await startControlledFixture(), provider = new CodexProvider();
let inferenceCalls = 0;
const folder = fileURLToPath(new URL('../../../test-results/desktop-live/m5/', import.meta.url));
mkdirSync(folder, { recursive: true });
let receipt;
try {
  const capability = await provider.prepare();
  const report = await runGenericScenario(plan([navigate('/contact-changed'), fill('Name', 'Synthetic Tester'), fill('Email', 'live@example.test'), click('Submit', ['Send Message']), check('Message received')]), {
    fixture, authorized: true, options: { headless: true, model: { generate: request => { inferenceCalls++; return provider.generate(request); } } },
  });
  const evidence = report.evidence.map(item => {
    const name = `live-${item.stepNumber}.png`; writeFileSync(folder + name, Buffer.from(item.screenshot.split(',')[1], 'base64'));
    return { ...item, screenshot: 'test-results/desktop-live/m5/' + name };
  });
  receipt = { verifiedAt: new Date().toISOString(), liveModelInference: inferenceCalls > 0, inferenceCalls, provider: capability, controlledSyntheticDataOnly: true, ...report, evidence };
} catch {
  receipt = { verifiedAt: new Date().toISOString(), liveModelInference: inferenceCalls > 0, inferenceCalls, outcome: 'BLOCKED', message: 'Live provider could not be prepared or execution failed. No mock substituted.' };
} finally { await fixture.close(); }
writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m5-live.json', import.meta.url)), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ outcome: receipt.outcome, inferenceCalls, adaptations: receipt.adaptations?.length, message: receipt.message }));
if (receipt.outcome !== 'PASS' || inferenceCalls === 0 || receipt.adaptations.length !== 1) process.exitCode = 1;
