import { parseTicket, validateTicketPlan } from '../../shared/ticket-plan.mjs';
import { loginScenarios } from '../../electron/scenarios.mjs';

/** Explicit synthetic approved expectations, not AI-generated executable mappings. */
export function executableProposal({ failing = false } = {}) {
  const plans = loginScenarios().slice(0, failing ? 3 : 2);
  const ticket = parseTicket({ title: 'QA-43: Controlled login verification', description: 'Synthetic test of the owned login fixture. Verify successful login and rejection of invalid credentials. The optional deliberate wrong dashboard assertion must fail.', acceptanceCriteria: plans.map(plan => plan.name) });
  const scenarios = plans.map((plan, index) => {
    const commands = plan.steps.filter(step => step.kind !== 'assert');
    const final = plan.steps.filter(step => step.kind === 'assert').slice(1);
    return {
      id: `S-${index + 1}`, criterionId: `AC-${index + 1}`, category: 'positive', title: plan.name,
      assumptionIds: [], preconditions: ['Owned controlled login fixture', 'Synthetic valid and invalid accounts'],
      steps: commands.map(command => ({ instruction: JSON.stringify(command), expectedOutcome: command.kind === 'fill' ? '[REDACTED]' : JSON.stringify({ kind: 'url', expected: command.kind === 'navigate' ? '/login' : index === 0 ? '/dashboard' : '/login?error=invalid' }) })),
      assertions: final.map(step => ({ kind: { url: 'url', text: 'text', visible: 'visibility' }[step.assertion.kind], description: JSON.stringify(step.assertion), exactValue: null, sourceQuote: null })),
    };
  });
  return validateTicketPlan(ticket, { assumptions: [], criteria: ticket.acceptanceCriteria.map(item => ({ criterionId: item.id, interpretation: 'testable', explanation: 'Explicit synthetic fixture verification.', negativeTests: { applicability: 'unspecified', reason: 'Separate criterion for invalid credentials.' }, boundaryTests: { applicability: 'unspecified', reason: 'No boundary requirement.' } })), scenarios });
}
export function approve(store, saved) {
  const act = action => saved = store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action });
  act({ type: 'start-review' });
  for (const item of saved.coverage) act({ type: 'criterion', criterionId: item.criterionId, confirmed: true, note: 'Synthetic fixture expectations explicitly reviewed.' });
  return act({ type: 'approve', hash: saved.hash });
}
export const executionIdentity = saved => ({ planId: saved.planId, revision: saved.revision, version: saved.version, hash: saved.hash });
export const executionRequest = (saved, preparation) => ({ ...executionIdentity(saved), preparationId: preparation.preparationId, environment: preparation.environment, origin: preparation.origin, authorized: true });
