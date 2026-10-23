import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {existsSync,readFileSync,statSync} from 'node:fs';import{join,resolve,extname,sep}from'node:path';import{fileURLToPath}from'node:url';import{z}from'zod';
import{StudioStore}from'./store.js';import{StudioAuth,type Session}from'./auth.js';import{ProjectRegistry}from'./projects.js';import{SqliteStore,ArtifactStore}from'../../storage/src/index.js';import{createGraphServer}from'../../navigation/src/viewer.js';
export class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
export function createStudioServer(home:string,roots:string[]=[]){
 const store=new StudioStore(home),auth=new StudioAuth(store),registry=new ProjectRegistry(store,roots);
 const projects=new Map<string,Promise<{viewer:ReturnType<typeof createGraphServer>;database:SqliteStore;origin:string}>>();
 const json=(response:ServerResponse,value:unknown,status=200)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 const server=createServer((request,response)=>{void handle(request,response).catch(error=>json(response,{error:error instanceof HttpError?error.message:'Studio operation rejected; check input, project scope and operator configuration'},error instanceof HttpError?error.status:400));});
 function cookieName(request:IncomingMessage){return `qaspider-studio-${request.socket.localPort}`;}
 function session(request:IncomingMessage){const cookie=request.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(request)+'='))?.split('=')[1];return cookie?auth.resolve(cookie):null;}
 function setCookie(request:IncomingMessage,response:ServerResponse,value:Session){const secure='encrypted'in request.socket&&request.socket.encrypted===true;response.setHeader('set-cookie',`${cookieName(request)}=${value.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((value.expiresAt-Date.now())/1000))}${secure?'; Secure':''}`);}
 async function body(request:IncomingMessage){let length=0;const chunks:Buffer[]=[];for await(const chunk of request){length+=chunk.length;if(length>262144)throw new HttpError(413,'Request too large');chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString()) as unknown;}
 async function project(id:string){const record=registry.get(id);let cached=projects.get(id);if(!cached){cached=(async()=>{const database=new SqliteStore(join(record.path,'.qaspider/memory.db'));const artifacts=new ArtifactStore(database,join(record.path,'.qaspider/artifacts'));const viewer=createGraphServer(database,artifacts);try{await new Promise<void>((resolve,reject)=>{viewer.server.once('error',reject);viewer.server.listen(0,'127.0.0.1',resolve);});const address=viewer.server.address();if(!address||typeof address==='string')throw new Error('Project service unavailable');return{database,viewer,origin:`http://127.0.0.1:${address.port}`};}catch(error){database.close();throw error;}})();projects.set(id,cached);cached.catch(()=>projects.delete(id));}return cached;}
 async function handle(request:IncomingMessage,response:ServerResponse){
  response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");response.setHeader('x-content-type-options','nosniff');response.setHeader('referrer-policy','no-referrer');response.setHeader('cache-control','no-store');
  const host=request.headers.host,port=request.socket.localPort;if(!host||![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw new HttpError(403,'Invalid host');const origin=`http://${host}`;
  if(request.headers.origin&&request.headers.origin!==origin)throw new HttpError(403,'Invalid origin');
  const url=new URL(request.url??'/',origin);if(url.origin!==origin||/%2f|%5c|%00/i.test(url.pathname))throw new HttpError(400,'Invalid path');
  let current=session(request);
  if(url.pathname==='/api/studio/auth'&&request.method==='GET'){if(!current){current=auth.open();setCookie(request,response,current);}json(response,{configured:auth.configured(),authenticated:current.authenticated,csrf:current.csrf});return;}
  if(url.pathname.startsWith('/api/')){
   if(!current)throw new HttpError(401,'Studio login required');
   if(request.method!=='GET'){
    if(request.method!=='POST'||request.headers.origin!==origin||!request.headers['content-type']?.startsWith('application/json')||!auth.csrf(current,String(request.headers['x-csrf-token']??'')))throw new HttpError(403,'Same-origin JSON and CSRF token required');
   }
   if(url.pathname==='/api/studio/setup'&&request.method==='POST'){const v=z.object({password:z.string()}).strict().parse(await body(request));await auth.setup(current,v.password);auth.revoke(current.token);const next=auth.open();setCookie(request,response,next);json(response,{configured:true,authenticated:false,csrf:next.csrf});return;}
   if(url.pathname==='/api/studio/login'&&request.method==='POST'){const v=z.object({password:z.string()}).strict().parse(await body(request));let next:Session;try{next=await auth.login(current,v.password);}catch{throw new HttpError(401,'Login rejected or temporarily limited');}setCookie(request,response,next);json(response,{configured:true,authenticated:true,csrf:next.csrf});return;}
   if(!current.authenticated)throw new HttpError(401,'Studio login required');
   if(url.pathname==='/api/studio/logout'&&request.method==='POST'){auth.revoke(current.token);response.setHeader('set-cookie',`${cookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);json(response,{status:'logged-out'});return;}
   if(url.pathname==='/api/studio/projects'&&request.method==='GET'){json(response,{projects:registry.list(),selected:registry.selected(),roots:registry.roots});return;}
   if(url.pathname==='/api/studio/projects'&&request.method==='POST'){
    const v=z.discriminatedUnion('operation',[z.object({operation:z.literal('create'),input:z.unknown()}).strict(),z.object({operation:z.literal('import'),path:z.string(),name:z.string()}).strict(),z.object({operation:z.enum(['select','archive']),id:z.string().uuid()}).strict(),z.object({operation:z.literal('rename'),id:z.string().uuid(),name:z.string()}).strict()]).parse(await body(request));
    if(v.operation==='create'){const p=registry.create(v.input);registry.select(p.id);}else if(v.operation==='import'){const p=registry.importPath(v.path,v.name);registry.select(p.id);}else if(v.operation==='select')registry.select(v.id);else if(v.operation==='archive')registry.archive(v.id);else if(v.operation==='rename')registry.rename(v.id,v.name);
    json(response,{projects:registry.list(),selected:registry.selected(),roots:registry.roots});return;
   }
   const match=/^\/api\/projects\/([a-f0-9-]{36})\/(api\/.*)$/.exec(url.pathname);
   if(match){const id=z.string().uuid().parse(match[1]);const backend=await project(id);const payload=request.method==='POST'?JSON.stringify(await body(request)):undefined;const forwarded=await fetch(`${backend.origin}/${match[2]}${url.search}`,{method:request.method,headers:{'x-qaspider-token':backend.viewer.token,...(payload?{'content-type':'application/json',origin:backend.origin}:{})},...(payload?{body:payload}:{}),redirect:'error'});response.writeHead(forwarded.status,{'content-type':forwarded.headers.get('content-type')??'application/json','cache-control':'no-store'});response.end(Buffer.from(await forwarded.arrayBuffer()));return;}
   throw new HttpError(404,'Unknown Studio operation');
  }
  if(request.method!=='GET')throw new HttpError(405,'Method not allowed');
  const compiled=fileURLToPath(new URL('../../../apps/viewer/public/',import.meta.url));const assets=existsSync(compiled)?compiled:resolve('dist/apps/viewer/public');const path=resolve(assets,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(resolve(assets)+sep)||!existsSync(path)||!statSync(path).isFile())throw new HttpError(404,'Studio asset missing; run npm run build');
  const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};response.writeHead(200,{'content-type':types[extname(path)]??'application/octet-stream'});response.end(readFileSync(path));
 }
 return{server,store,auth,registry,async shutdown(){for(const pending of projects.values()){const p=await pending.catch(()=>null);if(!p)continue;await p.viewer.shutdown();p.viewer.server.closeAllConnections();await new Promise<void>(resolve=>p.viewer.server.close(()=>resolve()));p.database.close();}server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}
