import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n');
for(const file of files){
 assert(!/(^|\/)(node_modules|\.qaspider|test-results|playwright-report)\//.test(file),`Private/generated file: ${file}`);
 assert(!/\.(db|db-wal|db-shm|env)$/.test(file),`Private file: ${file}`);
 if(!existsSync(file))continue;
 const text=readFileSync(file,'utf8');
 assert(!/#token=[A-Za-z0-9_-]{24,}/.test(text),`Dashboard token: ${file}`);
 assert(!/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text),`Private key: ${file}`);
}
const manifest=JSON.parse(readFileSync('validation/m5-migration-baseline.json','utf8'));
for(const [path,sha256] of Object.entries(manifest))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),sha256,`Migration altered: ${path}`);
for(const file of ['README.md','CONTRIBUTING.md','SECURITY.md','docs/DEVELOPMENT.md','docs/BETA_RELEASE_NOTES.md'])assert(existsSync(file),`Missing documentation: ${file}`);
console.log(JSON.stringify({status:'passed',reviewedFiles:files.length,migrationsUnchanged:5,checks:['private-paths','token-pattern','private-key-pattern','documentation']}));
