import {createStudioServer,type StudioDependencies} from '../../studio/src/server.js';
import {createEngineApi} from './api.js';
export function createEngine(home:string,roots:string[],authFile:string,options:Omit<StudioDependencies,'api'|'serveAssets'>={}){
 return createStudioServer(home,roots,{...options,serveAssets:false,api:createEngineApi(authFile)});
}
