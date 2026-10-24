import {createServer} from 'node:http';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
/** Optional web client. It has no project database, QA browser or provider ownership. */
export function createStudioClient(endpoint:string,options:{allowedHosts?:string[]}={}){
 const engine=new URL(endpoint);if(engine.protocol!=='http:'||engine.username||engine.password||engine.pathname!=='/'||engine.search||engine.hash)throw new Error('Use an operator-configured engine HTTP origin');
 const compiled=fileURLToPath(new URL('../../../apps/viewer/public/',import.meta.url));
 const assets=existsSync(resolve(compiled,'index.html'))?compiled:fileURLToPath(new URL('../../../dist/apps/viewer/public/',import.meta.url));
 const server=createServer((request,response)=>{void (async()=>{
  const host=request.headers.host,port=request.socket.localPort;
  if(!host||![`localhost:${port}`,`127.0.0.1:${port}`,...(options.allowedHosts??[])].includes(host))throw new Error('Invalid host');
  if(request.headers.origin&&request.headers.origin!==`http://${host}`)throw new Error('Invalid origin');
  const url=new URL(request.url??'/',`http://${host}`);if(url.origin!==`http://${host}`)throw new Error('Invalid URL');
  response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
  response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(url.pathname.startsWith('/api/')){
   // Browser sessions/CSRF stay engine-owned. Never forward browser-supplied transport credentials.
   const headers:Record<string,string>={};for(const name of ['content-type','cookie','x-csrf-token']){const v=request.headers[name];if(typeof v==='string')headers[name]=v;}
   if(request.headers.origin)headers.origin=engine.origin;
   let size=0;const parts:Buffer[]=[];for await(const part of request){size+=part.length;if(size>262144)throw new Error('Request too large');parts.push(Buffer.from(part));}
   const result=await fetch(`${engine.origin}${url.pathname}${url.search}`,{method:request.method??'GET',headers,...(parts.length?{body:Buffer.concat(parts)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
   response.statusCode=result.status;for(const name of ['content-type','set-cookie']){const v=result.headers.get(name);if(v)response.setHeader(name,v);}
   response.end(Buffer.from(await result.arrayBuffer()));return;
  }
  if(request.method!=='GET'){response.writeHead(405);response.end();return;}
  const path=resolve(assets,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(resolve(assets)+sep)||!existsSync(path)||!statSync(path).isFile()){response.writeHead(404);response.end();return;}
  response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'} as Record<string,string>)[extname(path)]??'application/octet-stream');response.end(readFileSync(path));
 })().catch(()=>{if(!response.headersSent)response.writeHead(403,{'content-type':'application/json'});response.end(JSON.stringify({error:'Studio request rejected or engine unavailable'}));});});
 return server;
}
