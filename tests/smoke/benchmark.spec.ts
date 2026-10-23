import { test, expect } from '@playwright/test';
test('registration, isolated roles, backend authorization and fixture cleanup', async ({ browser, request, baseURL }) => {
  const headers = { 'x-fixture-token': 'smoke-fixture-token' };
  expect((await request.post('/__fixtures/reset', { headers })).ok()).toBe(true);
  const guest = await browser.newContext(); const admin = await browser.newContext(); const user = await browser.newContext();
  try {
    const page = await guest.newPage(); await page.goto(baseURL!);
    await page.getByRole('link', { name: 'Register' }).click();
    await page.getByLabel('Email').fill('not-an-email'); await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click(); await expect(page.getByRole('alert')).toHaveText('Invalid email');
    await page.getByLabel('Email').fill('user@example.test'); await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email already exists');
    await page.getByLabel('Email').fill('smoke@example.test'); await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toHaveText('Account created');
    for (const [context, email, heading] of [[admin, 'admin@example.test', 'Admin dashboard'], [user, 'user@example.test', 'User dashboard']] as const) {
      const rolePage = await context.newPage(); await rolePage.goto(`${baseURL}/login`);
      await rolePage.getByLabel('Email').fill(email); await rolePage.getByLabel('Password').fill('benchmark-password');
      await rolePage.getByRole('button', { name: 'Sign in' }).click(); await expect(rolePage.getByRole('heading', { name: heading })).toBeVisible();
    }
    expect((await admin.request.get(`${baseURL}/api/admin/users`)).status()).toBe(200);
    expect((await user.request.get(`${baseURL}/api/admin/users`)).status()).toBe(403);
    expect((await guest.request.get(`${baseURL}/api/admin/users`)).status()).toBe(401);
    expect((await request.post('/__fixtures/setup', { headers, data: { email: 'fixture@example.test', role: 'user' } })).status()).toBe(201);
    expect((await request.post('/__fixtures/reset')).status()).toBe(403);
  } finally {
    await Promise.all([guest.close(), admin.close(), user.close()]);
    for (const email of ['smoke@example.test', 'fixture@example.test']) {
      expect((await request.post('/__fixtures/cleanup', { headers, data: { email } })).status()).toBe(200);
      expect((await request.post('/__fixtures/cleanup', { headers, data: { email } })).status()).toBe(200);
    }
  }
});
test('rejects cross-origin writes, unauthorized fixtures, malformed input and seed cleanup', async ({ request }) => {
  const headers = { 'x-fixture-token': 'smoke-fixture-token' };
  expect((await request.post('/api/register', { data: { email: '', password: '' } })).status()).toBe(400);
  expect((await request.post('/api/register', { headers: { origin: 'https://evil.example' }, data: { email: 'csrf@example.test', password: 'password123' } })).status()).toBe(403);
  expect((await request.get('/health', { headers: { host: 'evil.example' } })).status()).toBe(403);
  expect((await request.post('/__fixtures/setup', { data: { email: 'bad@example.test', role: 'admin' } })).status()).toBe(403);
  expect((await request.post('/__fixtures/cleanup', { headers, data: { email: 'admin@example.test' } })).status()).toBe(403);
});
