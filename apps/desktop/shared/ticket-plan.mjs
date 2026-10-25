import { z } from 'zod';

/** @param {number} max */
const text = max => z.string().trim().min(1).max(max);
export const ticketInputSchema = z.object({
  title: text(200), description: text(12000),
  acceptanceCriteria: z.array(text(2000)).min(1).max(20),
}).strict();
const criterionId = z.string().regex(/^AC-[1-9]\d*$/);
const assumptionId = z.string().regex(/^AS-[1-9]\d*$/);
const coverage = z.object({ applicability: z.enum(['included', 'not_applicable', 'unspecified']), reason: text(1000) }).strict();

// Business-level proposals, deliberately incompatible with executable M3 steps.
export const ticketDraftSchema = z.object({
  assumptions: z.array(z.object({ id: assumptionId, description: text(1000) }).strict()).max(60),
  criteria: z.array(z.object({
    criterionId, interpretation: z.enum(['testable', 'ambiguous', 'unsupported']), explanation: text(1000),
    negativeTests: coverage, boundaryTests: coverage,
  }).strict()).min(1).max(20),
  scenarios: z.array(z.object({
    id: z.string().regex(/^S-[1-9]\d*$/), criterionId,
    category: z.enum(['positive', 'negative', 'boundary']), title: text(200),
    assumptionIds: z.array(assumptionId).max(20), preconditions: z.array(text(1000)).max(10),
    steps: z.array(z.object({ instruction: text(1000), expectedOutcome: text(1000) }).strict()).min(1).max(12),
    assertions: z.array(z.object({
      kind: z.enum(['behavior', 'text', 'url', 'visibility']), description: text(1000),
      exactValue: z.string().min(1).max(2000).nullable(), sourceQuote: z.string().min(1).max(2000).nullable(),
    }).strict()).min(1).max(5),
  }).strict()).max(60),
}).strict();

export const ticketPlanSchema = ticketDraftSchema.extend({
  version: z.literal(1), status: z.literal('draft'), proposalSource: z.literal('ai'),
  ticket: z.object({ title: text(200), description: text(12000), acceptanceCriteria: z.array(z.object({ id: criterionId, text: text(2000) }).strict()).min(1).max(20) }).strict(),
}).strict();

/** @param {unknown} input */
export function parseTicket(input) {
  const parsed = ticketInputSchema.parse(input);
  return { ...parsed, acceptanceCriteria: parsed.acceptanceCriteria.map((text, index) => ({ id: `AC-${index + 1}`, text })) };
}

/** Structural validation is followed by references/coverage and literal-source checks.
 * @param {ReturnType<typeof parseTicket>} ticket
 * @param {unknown} draft
 * @returns {import('../src/TicketPlanning.js').TicketPlan}
 */
export function validateTicketPlan(ticket, draft) {
  const plan = ticketPlanSchema.parse({ ...ticketDraftSchema.parse(draft), version: 1, status: 'draft', proposalSource: 'ai', ticket });
  /** @param {boolean} condition @param {string} message */
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  /** @param {string[]} values */
  const unique = values => new Set(values).size === values.length;
  const sourceIds = ticket.acceptanceCriteria.map(item => item.id);
  require(unique(plan.criteria.map(item => item.criterionId)) && plan.criteria.length === sourceIds.length && plan.criteria.every(item => sourceIds.includes(item.criterionId)), 'Every original criterion must be assessed exactly once.');
  require(unique(plan.scenarios.map(item => item.id)), 'Scenario IDs must be unique.');
  require(unique(plan.assumptions.map(item => item.id)), 'Assumption IDs must be unique.');
  const assumptionIds = new Set(plan.assumptions.map(item => item.id));
  for (const scenario of plan.scenarios) {
    const criterion = ticket.acceptanceCriteria.find(item => item.id === scenario.criterionId);
    if (!criterion) throw new Error('Scenario references an unknown criterion.');
    require(unique(scenario.assumptionIds) && scenario.assumptionIds.every(id => assumptionIds.has(id)), 'Scenario references an unknown or duplicate assumption.');
    require(plan.criteria.find(item => item.criterionId === scenario.criterionId)?.interpretation === 'testable', 'Unresolved criteria must remain gaps rather than pretend executable scenarios.');
    for (const assertion of scenario.assertions) {
      require((assertion.exactValue === null) === (assertion.sourceQuote === null), 'An exact value needs a source quote; unspecified values must remain null.');
      if (assertion.exactValue !== null && assertion.sourceQuote !== null) {
        const quote = assertion.sourceQuote;
        require([criterion.text, ticket.description].some(source => source.includes(quote)) && quote.includes(assertion.exactValue), 'Exact assertion values must be quoted from the linked criterion or ticket description.');
      }
    }
  }
  for (const assessment of plan.criteria) {
    const scenarios = plan.scenarios.filter(item => item.criterionId === assessment.criterionId);
    require(assessment.interpretation !== 'testable' || scenarios.some(item => item.category === 'positive'), 'A testable criterion needs a positive scenario.');
    for (const category of ['negative', 'boundary']) {
      const coverage = category === 'negative' ? assessment.negativeTests : assessment.boundaryTests;
      require((coverage.applicability === 'included') === scenarios.some(item => item.category === category), 'Coverage claims must match the proposed scenarios.');
    }
  }
  return plan;
}
