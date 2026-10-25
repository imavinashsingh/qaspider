import { parseTicket, validateTicketPlan } from '../../shared/ticket-plan.mjs';
export const navigate = path => ({ kind: 'NAVIGATE', path });
export const fill = (label, value) => ({ kind: 'FILL', target: { label }, value });
export const click = (label, alternatives = []) => ({ kind: 'CLICK', target: { label, role: 'button', alternatives } });
export const check = expected => ({ kind: 'assert', assertion: { kind: 'text', selector: '#result', expected } });
export const plan = (steps, id = 'S-1') => ({ id, name: 'Synthetic generic test', steps });
export function genericProposal() {
  const ticket = parseTicket({ title: 'QA-5: Registration and contact', description: 'Verify required field validation and synthetic submission in owned test applications.', acceptanceCriteria: ['Registration reports Name and email are required', 'Contact confirms Message received'] });
  const sequences = [
    [navigate('/registration'), click('Create account'), check('Name and email are required')],
    [navigate('/contact'), fill('Name', 'Synthetic Tester'), fill('Email', 'qa@example.test'), click('Submit'), check('Message received')],
  ];
  const scenarios = sequences.map((steps, index) => ({ id: `S-${index + 1}`, criterionId: `AC-${index + 1}`, title: ticket.acceptanceCriteria[index].text, category: 'positive', assumptionIds: [], preconditions: ['Owned synthetic QA applications'],
    steps: steps.filter(step => step.kind !== 'assert').map(step => ({ instruction: JSON.stringify(step), expectedOutcome: step.kind === 'FILL' ? '[REDACTED]' : JSON.stringify(step.kind === 'NAVIGATE' ? { kind: 'url', expected: step.path } : steps.at(-1).assertion) })),
    assertions: [{ kind: 'text', description: JSON.stringify(steps.at(-1).assertion), exactValue: null, sourceQuote: null }],
  }));
  return validateTicketPlan(ticket, { assumptions: [], scenarios, criteria: ticket.acceptanceCriteria.map(item => ({ criterionId: item.id, interpretation: 'testable', explanation: 'Owned synthetic test', negativeTests: { applicability: 'unspecified', reason: 'Separate browser regressions' }, boundaryTests: { applicability: 'unspecified', reason: 'No boundary specified' } })) });
}
