let studio=false,projectId='',csrf='';
export function configureStudio(token:string,id=''){studio=true;csrf=token;projectId=id;}
export async function apiResponse(path:string,body?:unknown){
 const global=path.startsWith('/api/studio/')||path.startsWith('/api/v1/');if(studio&&!global&&!projectId)throw new Error('Select a project first');
 const target=studio&&!global?`/api/projects/${projectId}${path}`:path;
 const response=await fetch(target,{credentials:'same-origin',headers:{...(studio?{'x-csrf-token':csrf}:{'x-qaspider-token':sessionStorage.getItem('qaspider-token')??''}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
 if(response.status===401&&studio&&!global)window.dispatchEvent(new Event('studio-session-expired'));return response;
}
export async function api<T>(path:string,body?:unknown):Promise<T>{const response=await apiResponse(path,body);if(!response.ok){const data=await response.json() as {error:string};throw new Error(data.error);}return response.json() as Promise<T>;}
