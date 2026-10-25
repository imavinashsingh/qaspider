import { describe, expect, it, vi } from 'vitest';
import { parseTicket, validateTicketPlan } from '../shared/ticket-plan.mjs';
import { TicketPlanner, buildTicketRequest } from '../electron/ticket-planner.mjs';
import { registrationTicket, registrationDraft } from './fixtures/ticket.mjs';

function providerFor(draft = registrationDraft()) {
  return { prepare: vi.fn(async () => ({ provider: 'test-only', model: 'synthetic', synthetic: true })), generate: vi.fn(async () => ({ structuredContent: draft })) };
}
describe('M4.1 tickets and traceable plans', () => {
  it('parses multiple criteria without rewriting source text and assigns stable IDs', () => {
    const ticket = parseTicket(registrationTicket);
    expect(ticket.acceptanceCriteria).toEqual(registrationTicket.acceptanceCriteria.map((text, index) => ({ id: `AC-${index + 1}`, text })));
    expect(() => parseTicket({ ...registrationTicket, acceptanceCriteria: [] })).toThrow();
    expect(() => parseTicket({ ...registrationTicket, acceptanceCriteria: [' '] })).toThrow();
    expect(() => parseTicket({ ...registrationTicket, execute: true })).toThrow();
  });
  it('preserves stated requirements and links every AI scenario and assumption', () => {
    const plan = validateTicketPlan(parseTicket(registrationTicket), registrationDraft());
    expect(plan).toMatchObject({ status: 'draft', proposalSource: 'ai', version: 1 });
    expect(new Set(plan.scenarios.map(item => item.category))).toEqual(new Set(['positive', 'negative', 'boundary']));
    for (const scenario of plan.scenarios) {
      expect(plan.ticket.acceptanceCriteria.some(item => item.id === scenario.criterionId)).toBe(true);
      expect(scenario.assumptionIds).toEqual(['AS-1']);
      expect(scenario.assertions.every(item => item.exactValue === null && item.sourceQuote === null)).toBe(true);
    }
    expect(registrationTicket).not.toHaveProperty('assumptions');
  });
  it.each(['unknown criterion', 'missing criterion', 'duplicate scenario', 'unknown assumption', 'coverage mismatch', 'invented message', 'orphan quote', 'executable step'])('rejects %s', issue => {
    const draft = registrationDraft();
    if (issue === 'unknown criterion') draft.scenarios[0].criterionId = 'AC-99';
    if (issue === 'missing criterion') draft.criteria.pop();
    if (issue === 'duplicate scenario') draft.scenarios[1].id = draft.scenarios[0].id;
    if (issue === 'unknown assumption') draft.scenarios[0].assumptionIds = ['AS-99'];
    if (issue === 'coverage mismatch') draft.criteria[0].boundaryTests.applicability = 'unspecified';
    if (issue === 'invented message') Object.assign(draft.scenarios[0].assertions[0], { exactValue: 'Email missing!', sourceQuote: 'Email missing!' });
    if (issue === 'orphan quote') draft.scenarios[0].assertions[0].sourceQuote = 'Email is required.';
    if (issue === 'executable step') draft.scenarios[0].steps[0].selector = '#submit';
    expect(() => validateTicketPlan(parseTicket(registrationTicket), draft)).toThrow();
  });
  it('permits exact messages only with a literal linked ticket quote', () => {
    const input = { ...registrationTicket, acceptanceCriteria: ['Empty email shows "Email is required".', ...registrationTicket.acceptanceCriteria.slice(1)] };
    const draft = registrationDraft();
    Object.assign(draft.scenarios[1].assertions[0], { kind: 'text', exactValue: 'Email is required', sourceQuote: input.acceptanceCriteria[0] });
    expect(validateTicketPlan(parseTicket(input), draft).scenarios[1].assertions[0].exactValue).toBe('Email is required');
    draft.scenarios[1].assertions[0].sourceQuote = input.acceptanceCriteria[1];
    expect(() => validateTicketPlan(parseTicket(input), draft)).toThrow();
    input.acceptanceCriteria[0] = 'Empty email shows " Email is required ".';
    Object.assign(draft.scenarios[1].assertions[0], { exactValue: ' Email is required ', sourceQuote: input.acceptanceCriteria[0] });
    expect(validateTicketPlan(parseTicket(input), draft).scenarios[1].assertions[0].exactValue).toBe(' Email is required ');
  });
  it('retains ambiguous and unsupported criteria as explicit gaps', () => {
    const ticket = parseTicket({ title: 'Unclear release', description: 'Requirements need clarification.', acceptanceCriteria: ['Registration should be fast.', 'A physical badge must be shipped.'] });
    const criteria = ticket.acceptanceCriteria.map((item, index) => ({ criterionId: item.id, interpretation: index ? 'unsupported' : 'ambiguous', explanation: index ? 'Physical shipment is outside browser verification.' : 'No timing threshold or measurement is defined.', negativeTests: { applicability: 'unspecified', reason: 'Insufficient scope.' }, boundaryTests: { applicability: 'unspecified', reason: 'No boundary defined.' } }));
    const plan = validateTicketPlan(ticket, { assumptions: [], criteria, scenarios: [] });
    expect(plan.criteria.map(item => item.interpretation)).toEqual(['ambiguous', 'unsupported']);
    expect(plan.scenarios).toEqual([]);
  });
});
describe('M4.1 inference boundary', () => {
  it('sends only the supplied ticket as untrusted data with a strict output schema and no tools', async () => {
    const provider = providerFor();
    const result = await new TicketPlanner({ provider }).propose(registrationTicket);
    expect(result.status).toBe('proposed'); expect(provider.generate).toHaveBeenCalledTimes(1);
    const request = provider.generate.mock.calls[0][0];
    expect(request.tools).toEqual([]);
    expect(JSON.parse(request.messages[0].content[0].text).ticket).toEqual(parseTicket(registrationTicket));
    expect(request.responseFormat.schema.additionalProperties).toBe(false);
    expect(request.systemPrompt).toContain('untrusted task data');
    expect(buildTicketRequest(parseTicket(registrationTicket))).not.toHaveProperty('browser');
  });
  it('fails clearly when a provider is missing, incompatible or inference fails', async () => {
    expect((await new TicketPlanner().propose(registrationTicket)).status).toBe('unavailable');
    const provider = providerFor(); provider.prepare.mockRejectedValue(new Error('Private authentication detail'));
    const result = await new TicketPlanner({ provider }).propose(registrationTicket);
    expect(result.status).toBe('unavailable'); expect(result.message).not.toContain('Private'); expect(provider.generate).not.toHaveBeenCalled();
    provider.prepare.mockResolvedValue({}); provider.generate.mockRejectedValue(new Error('Private model response'));
    expect((await new TicketPlanner({ provider }).propose(registrationTicket)).message).not.toContain('Private');
  });
  it('rejects invalid AI output instead of substituting a plan', async () => {
    const provider = providerFor({ scenarios: [{ title: 'Unsupported shape' }] });
    const result = await new TicketPlanner({ provider }).propose(registrationTicket);
    expect(result.status).toBe('invalid-output'); expect(result).not.toHaveProperty('plan');
  });
  it('validates input before invoking any provider', async () => {
    const provider = providerFor();
    expect((await new TicketPlanner({ provider }).propose({ title: '' })).status).toBe('invalid-ticket');
    expect(provider.prepare).not.toHaveBeenCalled(); expect(provider.generate).not.toHaveBeenCalled();
  });
});
