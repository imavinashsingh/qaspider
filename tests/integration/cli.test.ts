import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCli } from '../../packages/cli/src/cli.js';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
it('initializes persistent local configuration, is repeatable, and diagnoses missing credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'qaspider-cli-')); roots.push(root); const lines: string[] = [];
  const output = (line: string) => lines.push(line);
  expect(runCli(['doctor', '--workspace', root], output, {})).toBe(1);
  expect(runCli(['init', '--workspace', root], output, {})).toBe(0);
  expect(runCli(['init', '--workspace', root], output, {})).toBe(0);
  expect(runCli(['doctor', '--workspace', root], output, {})).toBe(0);
  const report = JSON.parse(lines.at(-1)!);
  expect(report).toMatchObject({ status: 'ok', schemaVersions: [1, 2, 3, 4, 5, 6], provider: 'not-configured', productionWrites: false });
  expect(report.warnings).toContain('Missing credential references: QASPIDER_ADMIN_EMAIL, QASPIDER_ADMIN_PASSWORD, QASPIDER_USER_EMAIL, QASPIDER_USER_PASSWORD');
});
it('rejects unsupported flags and inline credential options', () => {
  expect(runCli(['init', '--password', 'must-not-be-logged'], () => {}, {})).toBe(1);
});
