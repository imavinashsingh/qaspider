import { z } from 'zod';
import { validateTarget } from './browser.mjs';

export const assertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), expected: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('text'), selector: z.string().min(1).max(1000), expected: z.string().min(1).max(4000) }).strict(),
]);

export function classifyClick(action, element, origin) {
  if (action.method !== 'click' || (action.arguments ?? []).length || !['A', 'BUTTON'].includes(element.tag)) return { allowed: false, reason: 'Only discovered links and buttons with argument-free click actions are supported.' };
  if (!element.visible || !element.enabled || element.inForm || element.download || (element.target && element.target !== '_self')) return { allowed: false, reason: 'Hidden, disabled, form, download and new-window actions cannot be validated in M2.' };
  if (element.tag === 'A') {
    let destination;
    try { destination = validateTarget(element.href); } catch { return { allowed: false, reason: 'Link destination is not a valid HTTP(S) application URL.' }; }
    if (destination.origin !== origin) return { allowed: false, reason: 'Link leaves the allowed application origin.' };
  }
  // DOM labels cannot prove the absence of application-side effects.
  return { allowed: true, requiresAuthorization: true, reason: element.tag === 'BUTTON' ? 'Button click may change application state.' : 'Navigation and click handlers may change application state.' };
}

export async function inspectAction(session, action) {
  if (typeof action.selector !== 'string' || !action.selector || action.selector.length > 2000) throw new Error('Invalid discovered selector.');
  const locator = session.controlledPage.locator(action.selector);
  if (await locator.count() !== 1) throw new Error('Action must resolve to exactly one current element.');
  const handle = await locator.elementHandle({ timeout: 2000 });
  if (!handle) throw new Error('Element disappeared.');
  const element = await locator.evaluate(node => ({
    tag: node.tagName, text: (node.textContent ?? '').trim().slice(0, 500), html: node.outerHTML,
    href: node instanceof HTMLAnchorElement ? node.href : '',
    target: node.getAttribute('target') ?? node.ownerDocument.querySelector('base')?.getAttribute('target') ?? '',
    download: node.hasAttribute('download'), inForm: Boolean(node.closest('form')) || (node instanceof HTMLButtonElement && Boolean(node.form)),
  }));
  element.visible = await locator.isVisible(); element.enabled = await locator.isEnabled();
  return { locator, handle, element, policy: classifyClick(action, element, session.target.origin) };
}

export function validateAssertion(value, origin) {
  const assertion = assertionSchema.parse(value);
  if (assertion.kind === 'url' && validateTarget(assertion.expected).origin !== origin) throw new Error('Expected URL must stay within the allowed origin.');
  return assertion;
}

export async function readAssertion(session, assertion) {
  if (assertion.kind === 'url') {
    const actual = await session.page.url();
    return { matched: actual === new URL(assertion.expected).href, actual };
  }
  const locator = session.controlledPage.locator(assertion.selector);
  const count = await locator.count();
  if (count > 1) throw new Error('Assertion selector is ambiguous.');
  if (count === 0 || !await locator.isVisible()) return { matched: false, actual: null };
  const actual = (await locator.innerText({ timeout: 1500 })).trim();
  return { matched: actual === assertion.expected, actual };
}
