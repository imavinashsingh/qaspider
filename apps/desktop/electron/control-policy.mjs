/** Shared with read-only draft preparation and the existing generic runner. */
export async function inspectControl(locator) {
  return locator.evaluate(node => ({
    names: [node.getAttribute('aria-label'), node.textContent?.trim(), ...Array.from(node.labels ?? [], label => label.textContent?.trim())].filter(Boolean),
    tag: node.tagName, type: node.type, readOnly: node.readOnly,
    href: node.getAttribute('href'), target: node.getAttribute('target') ?? node.form?.target ?? '',
    download: node.hasAttribute('download'), override: node.hasAttribute('formaction') || node.hasAttribute('formmethod'),
    action: node.form?.action, base: Boolean(node.ownerDocument.querySelector('base')), editable: node.isContentEditable,
    empty: ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ? node.value.length === 0 : null,
  }));
}
export function unsupportedControl(kind, element, owned) {
  if (element.base || element.override || element.download || (element.target && element.target !== '_self') || element.editable) return 'Unsupported control destination or behavior.';
  if (kind === 'FILL' && (!['INPUT', 'TEXTAREA'].includes(element.tag) || element.readOnly || ['file', 'hidden', 'submit', 'button', 'checkbox', 'radio'].includes(element.type))) return 'Unsupported fill control.';
  if (kind === 'SELECT' && element.tag !== 'SELECT') return 'Only native select controls are supported.';
  if (kind === 'CLICK') {
    if (!['BUTTON', 'A'].includes(element.tag)) return 'Only links and buttons can be clicked.';
    if (!owned && element.tag === 'BUTTON' && element.action && element.type === 'submit') return 'Form submission on user-selected applications is not supported by the current action policy.';
  }
  return null;
}
