import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'qaspider-clean-'));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(p=>p&&!p.startsWith('../'));
const commands=[];
try{
 for(const file of files){if(!existsSync(file))continue;const destination=join(root,file);mkdirSync(dirname(destination),{recursive:true});copyFileSync(file,destination);}
 assert(!existsSync(join(root,'node_modules')));assert(!existsSync(join(root,'dist')));assert(!existsSync(join(root,'.qaspider')));
 const run=(args)=>{const start=Date.now();const output=execFileSync(args[0],args.slice(1),{cwd:root,encoding:'utf8',timeout:180000,env:{...process.env,npm_config_cache:join(root,'.npm-cache')}});commands.push({command:args.join(' '),durationMs:Date.now()-start,exitCode:0});return output;};
 run(['npm','ci']);run(['npm','run','typecheck']);run(['npm','run','build']);run(['npm','test']);
 const workspace=join(root,'new-workspace');const cli=['node','dist/packages/cli/src/main.js'];
 const init=JSON.parse(run([...cli,'init','--workspace',workspace]));
 const doctor=JSON.parse(run([...cli,'doctor','--workspace',workspace]));
 const onboarding=JSON.parse(run([...cli,'onboard','--workspace',workspace,'--file','examples/m4/onboarding.json']));
 const configuration=JSON.parse(run([...cli,'configuration','--workspace',workspace]));
 assert(existsSync(join(workspace,'.qaspider/memory.db')));assert.equal(init.status,'initialized');assert.equal(doctor.status,'ok');assert.deepEqual(doctor.schemaVersions,[1,2,3,4,5]);assert(configuration.applications.some(a=>a.id==='my-app'));assert(onboarding.applications.some(a=>a.id==='my-app'));
 const result={status:'passed',checkedAt:new Date().toISOString(),node:process.version,sourceFileCount:files.length,freshDependencies:true,noExistingWorkspace:true,commands,init,doctor,onboarding,configuration};
 writeFileSync(resolve('validation/m5-clean-install.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',commands:commands.length,temporaryCopyRemoved:true}));
}finally{rmSync(root,{recursive:true,force:true});}
