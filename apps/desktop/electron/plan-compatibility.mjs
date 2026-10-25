import { z } from 'zod';
import { genericStepSchema, genericAssertionSchema, normalizePlan } from './generic-execution.mjs';
import { stepSchema, assertionSchema } from './scenario-runner.mjs';

const operation = stepSchema.refine(step => step.kind !== 'assert', 'Assertions belong in expected outcomes or final assertions.');
const parse = (schema, value) => schema.parse(JSON.parse(value));
export const fixturePreconditions = ['Owned controlled login fixture', 'Synthetic valid and invalid accounts', 'Owned synthetic QA applications'];

/** Explicit approved JSON only. No prose inference, selector discovery or expectation rewriting. */
export function checkCompatibility(snapshot, { ownedFixture = true } = {}) {
  return snapshot.content.scenarios.map(scenario => {
    if (snapshot.content.execution) {
      const binding = snapshot.content.execution.scenarios.find(item => item.scenarioId === scenario.id);
      try {
        if (!binding || binding.blockers.length || !snapshot.content.execution.note || binding.prerequisites.some(item => item.resolution === 'unresolved')) throw new Error('Incomplete binding');
        const plan = normalizePlan(JSON.parse(binding.planJson));
        return { scenarioId: scenario.id, criterionId: scenario.criterionId, title: scenario.title, classification: 'EXECUTABLE', checks: [{ source: 'Reviewed executable binding', classification: 'EXECUTABLE', reason: 'Commands, original assertion mappings and prerequisites are part of the approved revision.' }], plan, initialState: snapshot.content.execution.initialState ?? [] };
      } catch { return { scenarioId: scenario.id, criterionId: scenario.criterionId, title: scenario.title, classification: 'CONFIGURATION_REQUIRED', checks: [{ source: 'Executable binding', classification: 'CONFIGURATION_REQUIRED', reason: 'Resolve preparation blockers and review the exact executable binding.' }] }; }
    }
    const checks = [], steps = [];
    const check = (source, fn) => {
      try { fn(); checks.push({ source, classification: 'EXECUTABLE', reason: 'Explicit supported browser operation or measured assertion.' }); }
      catch { checks.push({ source, classification: 'UNSUPPORTED', reason: 'Needs an explicit supported command/assertion in a newly reviewed revision; no automatic mapping.' }); }
    };
    for (const [index, step] of scenario.steps.entries()) check(`Step ${index + 1}`, () => {
      const command = parse(z.union([operation, genericStepSchema.refine(step => step.kind !== 'assert')]), step.instruction);
      steps.push(command);
      if (['fill', 'FILL'].includes(command.kind)) {
        if (step.expectedOutcome !== '[REDACTED]') throw new Error('Declare redacted fill receipt');
      } else steps.push({ kind: 'assert', assertion: parse(z.union([assertionSchema, genericAssertionSchema]), step.expectedOutcome) });
    });
    for (const [index, item] of scenario.assertions.entries()) check(`Assertion ${index + 1}`, () => {
      const assertion = parse(z.union([assertionSchema, genericAssertionSchema]), item.description);
      const kinds = { url: 'url', text: 'text', visible: 'visibility', enabled: 'behavior' };
      if (item.kind !== kinds[assertion.kind] || (item.exactValue !== null && item.exactValue !== String(assertion.expected))) throw new Error('Declared assertion conflicts with approved source value');
      steps.push({ kind: 'assert', assertion });
    });
    const conditions = ownedFixture ? fixturePreconditions : ['User-authorized application origin'];
    for (const [index, condition] of scenario.preconditions.entries()) checks.push({ source: `Precondition ${index + 1}`, classification: conditions.includes(condition) ? 'EXECUTABLE' : 'CONFIGURATION_REQUIRED', reason: conditions.includes(condition) ? 'Provided by the selected execution target.' : 'This precondition has no verified target/configuration binding.' });
    let plan;
    check('Scenario structure', () => {
      plan = { id: scenario.id, name: scenario.title, steps };
      normalizePlan(plan);
      if (!['navigate', 'NAVIGATE'].includes(steps[0]?.kind) || steps.filter(step => ['navigate', 'NAVIGATE'].includes(step.kind)).length !== 1 || steps.at(-1)?.kind !== 'assert') throw new Error('Unsupported sequence');
    });
    const classification = checks.some(item => item.classification === 'UNSUPPORTED') ? 'UNSUPPORTED' : checks.some(item => item.classification === 'CONFIGURATION_REQUIRED') ? 'CONFIGURATION_REQUIRED' : 'EXECUTABLE';
    return { scenarioId: scenario.id, criterionId: scenario.criterionId, title: scenario.title, classification, checks, ...(classification === 'EXECUTABLE' ? { plan } : {}) };
  });
}
