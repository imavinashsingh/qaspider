// Trusted Node-side plans. The renderer selects IDs, never supplies browser commands.
export function loginScenarios() {
  const steps = account => [
    { kind: 'navigate', path: '/login' },
    { kind: 'assert', assertion: { kind: 'url', expected: '/login' } },
    { kind: 'fill', selector: '#username', account, field: 'username' },
    { kind: 'fill', selector: '#password', account, field: 'password' },
    { kind: 'click', selector: '#sign-in' },
  ];
  return [
    { id: 'valid-login', name: 'A: Valid credentials', steps: [...steps('valid'),
      { kind: 'assert', assertion: { kind: 'url', expected: '/dashboard' } },
      { kind: 'assert', assertion: { kind: 'visible', selector: '#dashboard', expected: true } },
      { kind: 'assert', assertion: { kind: 'text', selector: '#login-status', expected: 'Signed in successfully' } },
    ] },
    { id: 'invalid-login', name: 'B: Invalid credentials', steps: [...steps('invalid'),
      { kind: 'assert', assertion: { kind: 'url', expected: '/login?error=invalid' } },
      { kind: 'assert', assertion: { kind: 'text', selector: '#login-error', expected: 'Invalid username or password.' } },
      { kind: 'assert', assertion: { kind: 'visible', selector: '#dashboard', expected: false } },
    ] },
    { id: 'deliberate-failure', name: 'Deliberate failure: invalid login expects dashboard', steps: [...steps('invalid'),
      { kind: 'assert', assertion: { kind: 'url', expected: '/dashboard' } },
    ] },
  ];
}
