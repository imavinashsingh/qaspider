#!/usr/bin/env node
import { runCli } from './cli.js';
const args = process.argv.slice(2);
if(args.includes('--help')||args[0]==='help'){const {cliReference}=await import('../../core/src/cli-reference.js');console.log('QASpider — Node 24 local QA\n'+cliReference.map(c=>c.command+' '+c.options.join(' ')+'\n  '+c.description).join('\n'));}
else if (['studio','view','projects'].includes(args[0]??'')) {
 const {runStudioCli}=await import('./studio.js');process.exitCode=await runStudioCli(args);
} else if (['serve','onboard','configuration','settings','overview'].includes(args[0] ?? '')) {
  const { runApplicationCli } = await import('./application.js'); process.exitCode = await runApplicationCli(args);
} else if (['memory','diff','explore'].includes(args[0] ?? '')) {
  const { runLearningCli } = await import('./learning.js'); process.exitCode = await runLearningCli(args);
} else if (['story','plan','test','report','provider'].includes(args[0] ?? '')) {
  const { runTestingCli } = await import('./testing.js'); process.exitCode = await runTestingCli(args);
} else if (['map', 'graph', 'path', 'approve', 'replay'].includes(args[0] ?? '')) {
  const { runNavigationCli } = await import('./navigation.js'); process.exitCode = await runNavigationCli(args);
} else process.exitCode = runCli(args);
