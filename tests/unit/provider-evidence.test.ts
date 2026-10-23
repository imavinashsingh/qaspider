import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {ProviderEvidence} from '../../packages/providers/src/evidence.js';
it('retains verifiable private synthetic receipts and refuses traversal or symlink evidence roots',()=>{
 const root=mkdtempSync(join(tmpdir(),'qa-evidence-test-'));try{
  const evidence=new ProviderEvidence(join(root,'receipts'));evidence.write('wire.json',{tools:[],synthetic:true});
  const receipt=evidence.receipts()[0]!;const file=join(evidence.directory,receipt.name);
  expect(statSync(file).mode&0o777).toBe(0o600);expect(statSync(evidence.directory).mode&0o777).toBe(0o700);expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(receipt.sha256);
  expect(()=>evidence.write('../escape.json',{})).toThrow();symlinkSync(join(root,'receipts'),join(root,'linked'));expect(()=>new ProviderEvidence(join(root,'linked'))).toThrow('Symlink');
 }finally{rmSync(root,{recursive:true,force:true});}
});
