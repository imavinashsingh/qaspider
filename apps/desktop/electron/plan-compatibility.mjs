import { z } from 'zod';
import { stepSchema, assertionSchema, planSchema } from './scenario-runner.mjs';

const operation = stepSchema.refine(step => step.kind !== 'assert', 'Assertions belong in expected outcomes or final assertions.');
const parse = (schema, value) => schema.parse(JSON.parse(value));
const supportedAssertion = assertion => {
  if (assertion.kind !== 'url' && !['#dashboard', '#login-status', '#login-error'].includes(assertion.selector)) throw new Error('Unsupported assertion selector');
  if (assertion.kind === 'url' && (!assertion.expected.startsWith('/') || assertion.expected.startsWith('//') || new URL(assertion.expected, 'http://fixture.invalid').origin !== 'http://fixture.invalid')) throw new Error('Unsupported assertion URL');
  return assertion;
};
export const fixturePreconditions = ['Owned controlled login fixture', 'Synthetic valid and invalid accounts'];

/** Explicit approved JSON only. No prose inference, selector discovery or expectation rewriting. */
export function checkCompatibility(snapshot) {
  return snapshot.content.scenarios.map(scenario => {
    const checks = [], steps = [];
    const check = (source, fn) => {
      try { fn(); checks.push({ source, classification: 'EXECUTABLE', reason: 'Explicit supported M3 operation.' }); }
      catch { checks.push({ source, classification: 'UNSUPPORTED', reason: 'Needs an explicit supported command/assertion in a newly reviewed revision; no automatic mapping.' }); }
    };
    for (const [index, step] of scenario.steps.entries()) check(`Step ${index + 1}`, () => {
      const command = parse(operation, step.instruction);
      steps.push(command);
      if (command.kind === 'fill') {
        if (step.expectedOutcome !== '[REDACTED]') throw new Error('Declare redacted fill receipt');
      } else steps.push({ kind: 'assert', assertion: supportedAssertion(parse(assertionSchema, step.expectedOutcome)) });
    });
    for (const [index, item] of scenario.assertions.entries()) check(`Assertion ${index + 1}`, () => {
      const assertion = supportedAssertion(parse(assertionSchema, item.description));
      const kinds = { url: 'url', text: 'text', visible: 'visibility' };
      if (item.kind !== kinds[assertion.kind] || (item.exactValue !== null && item.exactValue !== String(assertion.expected))) throw new Error('Declared assertion conflicts with approved source value');
      steps.push({ kind: 'assert', assertion });
    });
    for (const [index, condition] of scenario.preconditions.entries()) checks.push({ source: `Precondition ${index + 1}`, classification: fixturePreconditions.includes(condition) ? 'EXECUTABLE' : 'CONFIGURATION_REQUIRED', reason: fixturePreconditions.includes(condition) ? 'Provided by the owned fixture.' : 'This precondition has no verified fixture/configuration binding.' });
    let plan;
    check('Scenario structure', () => {
      plan = planSchema.parse({ id: scenario.id, name: scenario.title, steps });
      if (steps[0]?.kind !== 'navigate' || steps.filter(step => step.kind === 'navigate').length !== 1 || steps.at(-1)?.kind !== 'assert') throw new Error('Unsupported sequence');
    });
    const classification = checks.some(item => item.classification === 'UNSUPPORTED') ? 'UNSUPPORTED' : checks.some(item => item.classification === 'CONFIGURATION_REQUIRED') ? 'CONFIGURATION_REQUIRED' : 'EXECUTABLE';
    return { scenarioId: scenario.id, criterionId: scenario.criterionId, title: scenario.title, classification, checks, ...(classification === 'EXECUTABLE' ? { plan } : {}) };
  });
}
