import {createStudioClient} from './client.js';
const server=createStudioClient(process.env.QASPIDER_ENGINE_URL??'http://127.0.0.1:4318');
server.listen(Number(process.env.QASPIDER_STUDIO_PORT??4319),process.env.QASPIDER_STUDIO_BIND??'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.closeAllConnections();server.close();});
