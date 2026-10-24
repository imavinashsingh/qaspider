import {mkdirSync,copyFileSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
const directory='dist/mcp-bridge';mkdirSync(directory,{recursive:true});
for(const file of ['main','server','client','connection'])copyFileSync(`dist/packages/bridge/src/${file}.js`,`${directory}/${file}.js`);
chmodSync(`${directory}/main.js`,0o755);
const root=JSON.parse(readFileSync('package.json','utf8'));
writeFileSync(`${directory}/package.json`,JSON.stringify({name:'@qaspider/mcp-bridge',version:'0.0.0',private:true,type:'module',engines:{node:'>=24 <25'},bin:{'qaspider-mcp':'main.js'},dependencies:{'@modelcontextprotocol/server':root.dependencies['@modelcontextprotocol/server'],zod:root.dependencies.zod}},null,2)+'\n');
writeFileSync(`${directory}/README.md`,'# QASpider MCP bridge\n\nSet QASPIDER_ENGINE_CONNECTION_FILE to a private connection JSON file and launch qaspider-mcp from your MCP client. No project database, Playwright runtime or AI provider runs here. See deploy/README.md in the source repository for configuration.\n');
