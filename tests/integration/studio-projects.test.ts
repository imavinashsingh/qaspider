import {it,expect} from 'vitest';import {mkdtempSync,mkdirSync,rmSync,existsSync,symlinkSync} from 'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{StudioStore}from'../../packages/studio/src/store.js';import{ProjectRegistry}from'../../packages/studio/src/projects.js';
import{initializeWorkspace}from'../../packages/application/src/workspace.js';
it('registers canonical workspaces once, restricts browser paths, persists rename/archive/selection and never deletes evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-projects-'));const home=join(root,'registry'),allowed=join(root,'projects');mkdirSync(allowed);const store=new StudioStore(home);const registry=new ProjectRegistry(store,[allowed]);
 try{
  const a=registry.create({name:'A',directory:'a',origin:'http://127.0.0.1:4317',environmentName:'QA'});expect(registry.register(a.path,'Alias').id).toBe(a.id);expect(registry.list()).toHaveLength(1);registry.select(a.id);expect(registry.selected()).toBe(a.id);
  expect(()=>registry.create({name:'Bad',directory:'../escape',origin:'http://127.0.0.1:4317',environmentName:'QA'})).toThrow();expect(()=>registry.importPath('/etc','Bad')).toThrow();
  const outside=join(root,'outside');initializeWorkspace(outside,'Outside','http://127.0.0.1:4317');symlinkSync(outside,join(allowed,'link'));expect(()=>registry.importPath(join(allowed,'link'),'Link')).toThrow();
  registry.rename(a.id,'Renamed');registry.archive(a.id);expect(registry.selected()).toBeNull();expect(existsSync(join(a.path,'.qaspider/memory.db'))).toBe(true);expect(registry.list(true)[0]?.name).toBe('Renamed');expect(()=>registry.get(a.id)).toThrow();
  expect(()=>registry.create({name:'Invalid',directory:'invalid',origin:'https://example.test/path',environmentName:'QA'})).toThrow();expect(existsSync(join(allowed,'invalid'))).toBe(false);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
