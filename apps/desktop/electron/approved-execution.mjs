import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { startControlledFixture } from './controlled-fixture.mjs';
import { runScenario, redact } from './scenario-runner.mjs';
import { checkCompatibility } from './plan-compatibility.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';

const identity = z.object({ planId: z.string().uuid(), revision: z.number().int().positive(), version: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const executeRequest = identity.extend({ preparationId: z.string().uuid(), origin: z.string(), environment: z.literal('owned-login-fixture'), authorized: z.literal(true) }).strict();
const now = () => new Date().toISOString();

export function requireApproved(store, input) {
  const request = identity.parse(input), saved = store.get(request.planId);
  if (saved.status !== 'APPROVED' || saved.issues.length || ['revision', 'version', 'hash'].some(key => saved[key] !== request[key])) throw new Error('Reload the exact latest approved revision. Unapproved, changed and stale plans cannot execute.');
  return saved;
}
function consolidate(report) {
  report.coverage = report.plannedCoverage.map(item => {
    const scenarios = report.scenarios.filter(run => run.criterionId === item.criterionId);
    const executed = scenarios.filter(run => run.result?.assertionsExecuted > 0).map(run => run.scenarioId);
    const verified = scenarios.length > 0 && scenarios.every(run => run.status === 'COMPLETED' && run.outcome === 'PASS');
    return { ...item, executedScenarioIds: executed, verified, executed: verified ? 'PASS' : executed.length ? 'PARTIAL' : 'NOT_EXECUTED' };
  });
  report.gaps = report.scenarios.filter(item => item.outcome !== 'PASS').map(item => `${item.scenarioId}: ${item.outcome} — ${item.message ?? 'See step evidence.'}`);
  for (const item of report.coverage) if (!item.verified) report.gaps.push(`${item.criterionId}: required coverage remains unverified.`);
  report.outcome = report.scenarios.some(item => item.outcome === 'FAIL') ? 'FAIL' : report.scenarios.some(item => item.outcome === 'BLOCKED') ? 'BLOCKED' : report.status === 'COMPLETED' && report.coverage.length > 0 && report.coverage.every(item => item.verified) ? 'PASS' : 'INCONCLUSIVE';
}

/** Bounded adapter around M3, with one prepared owned fixture capability. */
export class ApprovedExecution {
  constructor(store, { options = {}, runner = runScenario } = {}) { this.store = store; this.options = options; this.runner = runner; }
  async close() {
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); await pending.fixture.close(); }
  }
  async prepare(input) {
    const saved = requireApproved(this.store, input);
    await this.close();
    const compatibility = checkCompatibility(saved);
    const fixture = await startControlledFixture();
    const preparationId = randomUUID();
    const expiresAt = Date.now() + 300_000;
    const timer = setTimeout(() => { void this.close().catch(() => {}); }, 300_000); timer.unref();
    this.pending = { fixture, preparationId, identity: identity.parse(input), timer, expiresAt };
    return { preparationId, environment: 'owned-login-fixture', origin: fixture.origin, expiresAt: new Date(expiresAt).toISOString(), compatibility, fixturesReady: [testAccount, invalidAccount].every(account => Boolean(account.username && account.password)) };
  }
  async execute(input) {
    const request = executeRequest.parse(input);
    const saved = requireApproved(this.store, identity.parse(Object.fromEntries(Object.keys(identity.shape).map(key => [key, request[key]]))));
    const pending = this.pending;
    if (!pending || Date.now() >= pending.expiresAt || pending.preparationId !== request.preparationId || pending.fixture.origin !== request.origin || Object.keys(identity.shape).some(key => request[key] !== pending.identity[key])) throw new Error('Prepare and confirm the exact fixture origin for this revision first.');
    this.pending = undefined; clearTimeout(pending.timer);
    const report = {
      id: randomUUID(), planId: saved.planId, ticketIdentifier: saved.planId, title: saved.original.ticket.title,
      revision: saved.revision, hash: saved.hash, approvedRevision: { original: saved.original, content: saved.content, approval: saved.approvals.find(item => item.revision === saved.revision) },
      environment: request.environment, origin: pending.fixture.origin, startedAt: now(), status: 'RUNNING', outcome: 'INCONCLUSIVE', plannedCoverage: saved.coverage,
      scenarios: checkCompatibility(saved).map(item => ({ scenarioId: item.scenarioId, criterionId: item.criterionId, title: item.title, compatibility: item, status: 'NOT RUN', outcome: 'NOT RUN' })), coverage: [], gaps: [],
    };
    const save = () => { consolidate(report); this.store.saveExecution(redact(report)); };
    try {
      save(); // Durable intent precedes the first browser action.
      for (const scenario of report.scenarios) {
        scenario.startedAt = now(); scenario.status = 'RUNNING'; save();
        if (scenario.compatibility.classification !== 'EXECUTABLE') {
          scenario.outcome = 'BLOCKED'; scenario.message = 'Unsupported steps or unverified preconditions; no browser operations attempted.';
        } else if (![testAccount, invalidAccount].every(account => Boolean(account.username && account.password))) {
          scenario.outcome = 'BLOCKED'; scenario.message = 'Required synthetic credentials are unavailable.';
        } else {
          scenario.result = await this.runner(scenario.compatibility.plan, {
            fixture: pending.fixture, authorized: true, options: this.options,
            checkpoint: async partial => { scenario.result = partial; scenario.outcome = partial.outcome; save(); },
          });
          scenario.outcome = scenario.result.outcome;
          if (scenario.outcome === 'PASS' && !(scenario.result.assertionsExecuted > 0 && scenario.result.browserClosed && scenario.result.evidence.length > 0 && scenario.result.steps.length === scenario.compatibility.plan.steps.length && scenario.result.steps.every(step => step.outcome === 'PASS'))) {
            scenario.outcome = 'INCONCLUSIVE'; scenario.message = 'Runner completion lacks required assertions, evidence or browser cleanup.';
          }
        }
        scenario.completedAt = now(); scenario.status = 'COMPLETED'; save();
      }
    } catch {
      report.gaps.push('Execution or evidence persistence was interrupted.');
      for (const scenario of report.scenarios) if (scenario.status === 'RUNNING') { scenario.status = 'INTERRUPTED'; if (scenario.outcome !== 'FAIL') scenario.outcome = 'INCONCLUSIVE'; scenario.message = 'Execution interrupted; remaining operations were not run.'; }
      report.interrupted = true;
    } finally {
      try { await pending.fixture.close(); }
      catch { report.interrupted = true; }
      report.status = 'COMPLETED'; report.completedAt = now();
      consolidate(report);
      if (report.interrupted) { if (report.outcome !== 'FAIL') report.outcome = 'INCONCLUSIVE'; report.gaps.push('Execution or fixture cleanup interrupted; report cannot establish PASS.'); }
      this.store.saveExecution(redact(report));
    }
    return redact(report);
  }
}
