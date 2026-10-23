import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
const port=(value,fallback)=>{const result=Number(value??fallback);if(!Number.isInteger(result)||result<1||result>65535)throw new Error('Ports must be integers from 1 to 65535');return result;};
const benchmark=process.argv.slice(2).includes('--benchmark');
if(process.argv.slice(2).some(arg=>arg!=='--benchmark'))throw new Error('Supported option: --benchmark');
const studioPort=port(process.env.QASPIDER_STUDIO_PORT,4319);
const benchmarkPort=port(process.env.QASPIDER_BENCHMARK_PORT,4317);
if(benchmark&&studioPort===benchmarkPort)throw new Error('Studio and benchmark need different ports');
const root=resolve(process.env.QASPIDER_PROJECTS_ROOT??'.qaspider/projects');
mkdirSync(root,{recursive:true,mode:0o700});
const env={...process.env,...(benchmark?{BENCHMARK_FIXTURE_TOKEN:process.env.BENCHMARK_FIXTURE_TOKEN??randomBytes(32).toString('hex')}:{})};
const children=new Set();let stopping=false;let force;
function stop(code){
 if(stopping)return;stopping=true;process.exitCode=code;
 for(const child of children)child.kill('SIGTERM');
 force=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');},5000);force.unref();
}
function launch(args,extra={}){
 const child=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','inherit','inherit'],shell:false});children.add(child);
 child.on('error',()=>{console.error('QASpider service could not start');stop(1);});
 child.on('close',()=>{children.delete(child);if(!stopping){console.error('QASpider service stopped; shutting down the other service. Check for occupied ports.');stop(1);}if(!children.size)clearTimeout(force);});
}
process.once('SIGINT',()=>stop(0));process.once('SIGTERM',()=>stop(0));
if(benchmark)launch(['dist/apps/benchmark/src/main.js'],{PORT:String(benchmarkPort)});
launch(['dist/packages/cli/src/main.js','studio','--projects-root',root,'--port',String(studioPort)]);
console.log(`Starting QASpider Studio: http://127.0.0.1:${studioPort}/`);
if(benchmark)console.log(`Starting local benchmark: http://127.0.0.1:${benchmarkPort}/`);
console.log('Enable and monitor project MCP in Studio Settings → MCP. External MCP clients: npm run --silent start:mcp -- --workspace /absolute/workspace --authorization /absolute/authorization.json');
