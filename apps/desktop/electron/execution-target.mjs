import { validateTarget } from './browser.mjs';
import { isOwnedFixture } from './controlled-fixture.mjs';

// Main-process capability: a renderer URL alone never authorizes execution.
const selected = new WeakSet();
export const isExecutionTarget = target => isOwnedFixture(target) || selected.has(target);
export function selectApplicationTarget(input) {
  const url = validateTarget(input);
  const target = Object.freeze({
    origin: url.origin,
    close: async () => { selected.delete(target); },
  });
  selected.add(target);
  return target;
}
