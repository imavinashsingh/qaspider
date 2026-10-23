#!/usr/bin/env node
import { runCli } from './cli.js';
const args = process.argv.slice(2);
if (['map', 'graph', 'path', 'approve', 'replay', 'view'].includes(args[0] ?? '')) {
  const { runNavigationCli } = await import('./navigation.js'); process.exitCode = await runNavigationCli(args);
} else process.exitCode = runCli(args);
