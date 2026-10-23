#!/usr/bin/env node
import { runCli } from './cli.js';
const args = process.argv.slice(2);
if (['memory','diff','explore'].includes(args[0] ?? '')) {
  const { runLearningCli } = await import('./learning.js'); process.exitCode = await runLearningCli(args);
} else if (['story','plan','test','report','provider'].includes(args[0] ?? '')) {
  const { runTestingCli } = await import('./testing.js'); process.exitCode = await runTestingCli(args);
} else if (['map', 'graph', 'path', 'approve', 'replay', 'view'].includes(args[0] ?? '')) {
  const { runNavigationCli } = await import('./navigation.js'); process.exitCode = await runNavigationCli(args);
} else process.exitCode = runCli(args);
