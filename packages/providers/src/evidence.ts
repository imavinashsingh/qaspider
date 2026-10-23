import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {privateDirectory} from '../../storage/src/filesystem.js';
export interface EvidenceReceipt{name:string;sha256:string;bytes:number;}
/** Only synthetic verification data belongs here; never record auth headers or real planning context. */
export class ProviderEvidence{
 readonly directory:string;private readonly files:EvidenceReceipt[]=[];
 constructor(directory:string){this.directory=privateDirectory(directory);}
 write(name:string,value:unknown){
  if(!/^[a-z0-9][a-z0-9-]*\.json$/.test(name))throw new Error('Invalid evidence filename');
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  writeFileSync(join(this.directory,name),bytes,{mode:0o600,flag:'wx'});
  this.files.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
 }
 receipts(){return this.files.map(receipt=>({...receipt}));}
}
