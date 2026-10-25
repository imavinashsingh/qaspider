import { genericProposal, navigate, click } from './generic-plan.mjs';
export function knowledgeProposal() {
  const value = genericProposal();
  value.scenarios[1].steps[0] = { instruction: JSON.stringify(navigate('/contact-changed')), expectedOutcome: JSON.stringify({ kind: 'url', expected: '/contact-changed' }) };
  value.scenarios[1].steps.at(-1).instruction = JSON.stringify(click('Submit', ['Send Message', 'Send request']));
  return value;
}
