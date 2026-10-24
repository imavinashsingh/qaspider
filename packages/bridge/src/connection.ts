import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
export function privateConnection(path:string):unknown{
 const absolute=resolve(path);if(realpathSync(absolute)!==absolute)throw new Error('Connection path must not contain symlinks');
 const stat=statSync(absolute);if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error('Connection file must be private (0600)');
 return JSON.parse(readFileSync(absolute,'utf8')) as unknown;
}
