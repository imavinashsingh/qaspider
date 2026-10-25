// Explicit synthetic model response for tests, never a production fallback.
export const registrationTicket = {
  title: 'Validate registration form', description: 'Check registration using an email address.',
  acceptanceCriteria: ['Email is required.', 'Duplicate email addresses must be rejected.', 'Valid registration should succeed.'],
};
export function registrationDraft() {
  const assessment = (id, negative = false, boundary = false) => ({
    criterionId: id, interpretation: 'testable', explanation: 'The criterion describes observable registration behavior.',
    negativeTests: { applicability: negative ? 'included' : 'unspecified', reason: negative ? 'Missing email exercises invalid input.' : 'Additional invalid-input rules are unspecified.' },
    boundaryTests: { applicability: boundary ? 'included' : 'unspecified', reason: boundary ? 'Empty input is the stated required-field edge.' : 'No numeric limits or other boundaries are specified.' },
  });
  const scenario = (id, criterionId, category, title, instruction, outcome) => ({
    id, criterionId, category, title, assumptionIds: ['AS-1'], preconditions: ['A controlled registration fixture and synthetic email data are available (AI assumption AS-1).'],
    steps: [{ instruction, expectedOutcome: outcome }],
    assertions: [{ kind: 'behavior', description: outcome, exactValue: null, sourceQuote: null }],
  });
  return {
    assumptions: [{ id: 'AS-1', description: 'A controlled registration fixture supports synthetic existing and unused email addresses and otherwise valid registration data.' }],
    criteria: [assessment('AC-1', true, true), assessment('AC-2'), assessment('AC-3')],
    scenarios: [
      scenario('S-1', 'AC-1', 'positive', 'Provide an email', 'Enter a synthetic email with otherwise valid data.', 'The required-email check is satisfied.'),
      scenario('S-2', 'AC-1', 'negative', 'Omit the email', 'Submit registration without an email.', 'Registration is rejected because email is required; exact message unspecified.'),
      scenario('S-3', 'AC-1', 'boundary', 'Clear the email', 'Enter a synthetic email, clear it to zero characters, and submit.', 'Registration is rejected for empty email; exact message unspecified.'),
      scenario('S-4', 'AC-2', 'positive', 'Reject existing email', 'Attempt registration using a synthetic existing email.', 'Duplicate registration is rejected; exact message unspecified.'),
      scenario('S-5', 'AC-3', 'positive', 'Accept valid registration', 'Submit valid synthetic registration data with an unused email.', 'Registration succeeds; exact success message and destination unspecified.'),
    ],
  };
}
