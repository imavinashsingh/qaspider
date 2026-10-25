import { z } from 'zod';
import { ticketDraftSchema } from './ticket-plan.mjs';

const note = z.string().trim().max(4000);
export const reviewContentSchema = z.object({
  scenarios: ticketDraftSchema.shape.scenarios,
  assumptions: z.array(z.object({ id: z.string(), decision: z.enum(['unresolved', 'confirmed', 'rejected']), note }).strict().refine(item => item.decision === 'unresolved' || item.note.length > 0, 'A decision needs a review note.')).max(60),
  criteria: z.array(z.object({ criterionId: z.string(), confirmed: z.boolean(), note }).strict().refine(item => !item.confirmed || item.note.length > 0, 'Coverage confirmation needs a review note.')).max(20),
}).strict();
/** @typedef {z.infer<typeof reviewContentSchema>} ReviewContent */
/** @typedef {import('../src/TicketPlanning.js').TicketPlan} TicketPlan */

/** @param {TicketPlan} original @returns {ReviewContent} */
export function initialReview(original) {
  return {
    scenarios: structuredClone(original.scenarios),
    assumptions: original.assumptions.map(item => ({ id: item.id, decision: 'unresolved', note: '' })),
    criteria: original.ticket.acceptanceCriteria.map(item => ({ criterionId: item.id, confirmed: false, note: '' })),
  };
}

/** Retained scenarios may change prose, never their original requirement links.
 * @param {TicketPlan} original @param {unknown} input @returns {ReviewContent}
 */
export function validateReviewContent(original, input) {
  const content = reviewContentSchema.parse(input);
  /** @param {string[]} a @param {string[]} b */
  const sameIds = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
  if (!sameIds(content.assumptions.map(item => item.id), original.assumptions.map(item => item.id)) || !sameIds(content.criteria.map(item => item.criterionId), original.ticket.acceptanceCriteria.map(item => item.id))) throw new Error('Original requirements and assumptions cannot be replaced.');
  if (new Set(content.scenarios.map(item => item.id)).size !== content.scenarios.length) throw new Error('Duplicate scenario.');
  for (const scenario of content.scenarios) {
    const source = original.scenarios.find(item => item.id === scenario.id);
    if (!source || source.criterionId !== scenario.criterionId || source.category !== scenario.category || JSON.stringify(source.assumptionIds) !== JSON.stringify(scenario.assumptionIds) || JSON.stringify(source.preconditions) !== JSON.stringify(scenario.preconditions) || source.assertions.length !== scenario.assertions.length) throw new Error('Scenario traceability cannot be changed.');
    for (const [index, assertion] of scenario.assertions.entries()) {
      const prior = source.assertions[index];
      if (!prior || prior.kind !== assertion.kind || prior.exactValue !== assertion.exactValue || prior.sourceQuote !== assertion.sourceQuote) throw new Error('Literal source assertions cannot be silently rewritten.');
    }
  }
  return content;
}

/** @param {TicketPlan} original @param {ReviewContent} content */
export function plannedCoverage(original, content) {
  return original.ticket.acceptanceCriteria.map(criterion => {
    const scenarios = content.scenarios.filter(item => item.criterionId === criterion.id);
    const blocking = content.assumptions.filter(item => scenarios.some(scenario => scenario.assumptionIds.includes(item.id)) && item.decision !== 'confirmed');
    const decision = content.criteria.find(item => item.criterionId === criterion.id);
    return {
      criterionId: criterion.id, text: criterion.text, scenarioIds: scenarios.map(item => item.id),
      planned: scenarios.length === 0 ? 'gap' : decision?.confirmed && !blocking.length ? 'reviewed' : 'proposed',
      blockingAssumptionIds: blocking.map(item => item.id), executed: 'NOT_EXECUTED',
    };
  });
}

/** @param {TicketPlan} original @param {ReviewContent} content */
export function approvalIssues(original, content) {
  return plannedCoverage(original, content).flatMap(item => [
    ...(item.scenarioIds.length ? [] : [`${item.criterionId}: no retained scenario with an assertion.`]),
    ...(content.criteria.find(decision => decision.criterionId === item.criterionId)?.confirmed ? [] : [`${item.criterionId}: confirm planned coverage with a review note.`]),
    ...item.blockingAssumptionIds.map(id => `${item.criterionId}: ${id} is unresolved or rejected.`),
  ]);
}
