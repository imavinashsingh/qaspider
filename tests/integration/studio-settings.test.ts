import{it,expect}from'vitest';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{StudioStore}from'../../packages/studio/src/store.js';import{ProviderSettings,mcpInformation}from'../../packages/studio/src/settings.js';
it('persists defaults and independent overrides, rejects unapproved binaries/fields and pins MCP configuration to one project',()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-settings-'));const store=new StudioStore(root);const settings=new ProviderSettings(store,process.execPath);
 try{const initial=settings.get();expect(initial.allowContextSharing).toBe(false);expect(()=>settings.adapter()).toThrow('permission');expect(()=>settings.save('',{...initial,executable:'/bin/sh'})).toThrow();expect(()=>settings.save('',{...initial,apiKey:'secret'})).toThrow();
 settings.save('',{...initial,model:'global-model'});settings.save('project-a',{...initial,model:'project-model'});expect(settings.get('project-a').model).toBe('project-model');expect(settings.get('project-b').model).toBe('global-model');expect(settings.status().status).toBe('unverified');
 const project={id:'stable-id',name:'A',path:join(root,'project'),createdAt:1,lastOpenedAt:null,archived:false};const mcp=mcpInformation(project);expect(JSON.stringify(mcp.configuration)).toContain(project.path);expect(mcp.projectId).toBe(project.id);expect(mcp.authorizationPresent).toBe(false);expect(mcp.tools).toContain('get_report');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
it('fails closed on unsupported executables and does not save a verified receipt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-unsupported-'));const store=new StudioStore(root);const settings=new ProviderSettings(store,process.execPath);
 try{await expect(settings.verify()).rejects.toThrow();expect(settings.status().status).toBe('unverified');expect(settings.status().verification).toBeNull();}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
