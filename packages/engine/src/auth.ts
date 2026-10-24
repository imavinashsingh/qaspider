import {createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
import {assertNoSymlinks} from '../../storage/src/filesystem.js';
const principalSchema=z.object({id:z.string().min(1).max(100),kind:z.enum(['agent','human']),tokenHash:z.string().regex(/^[a-f0-9]{64}$/),projects:z.array(z.string().uuid()).max(1000),actions:z.array(z.enum(['read','plan','execute','explore','manage','review'])).min(1)}).strict();
export type Principal=z.infer<typeof principalSchema>;
export type EngineAction=Principal['actions'][number];
export function privateJson(path:string):unknown {
 assertNoSymlinks(path);const stat=statSync(path);if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error('Credential file must be private (0600)');
 return JSON.parse(readFileSync(path,'utf8')) as unknown;
}
export function engineAuth(path:string){
 const principals=z.array(principalSchema).min(1).parse(privateJson(path));
 return (authorization:string|undefined)=>{
  if(!authorization?.startsWith('Bearer '))throw new Error('Authentication required');
  const hash=createHash('sha256').update(authorization.slice(7)).digest();
  const principal=principals.find(p=>timingSafeEqual(hash,Buffer.from(p.tokenHash,'hex')));
  if(!principal)throw new Error('Authentication required');return principal;
 };
}
export function authorize(principal:Principal,projectId:string,action:EngineAction){
 if(!principal.projects.includes(projectId)||!principal.actions.includes(action))throw new Error('Project or operation not authorized');
 if(['manage','review'].includes(action)&&principal.kind!=='human')throw new Error('Authenticated human operation required');
}
