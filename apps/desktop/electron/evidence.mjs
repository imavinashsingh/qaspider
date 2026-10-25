/** Shared execution screenshot policy. Plain capture/observation retain their existing policy. */
export async function maskedExecutionScreenshot(session, timeout) {
  const bytes = await session.controlledPage.screenshot({ type: 'png', timeout, mask: [session.controlledPage.locator('input, textarea, select')], maskColor: '#18283b' });
  return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}
