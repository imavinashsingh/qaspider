import{it,expect}from'vitest';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{cliReference}from'../../packages/core/src/cli-reference.js';
it('documents real commands without credentials or fictitious executable placeholders',()=>{
 expect(cliReference.map(c=>c.command)).toEqual(expect.arrayContaining(['init','map','test replay','serve --mcp','projects register','plan approve']));
 for(const command of cliReference){expect(command.description.length).toBeGreaterThan(10);expect(command.options).toContain('--workspace');expect(command.example).not.toMatch(/#token=|--password|api[_-]?key/i);}
});

it('keeps installed help and documented options aligned with the actual strict CLI parsers',()=>{
 const help=execFileSync(process.execPath,['dist/packages/cli/src/main.js','--help'],{encoding:'utf8'});
 const source=['cli','studio','navigation','testing','learning','application'].map(name=>readFileSync(`packages/cli/src/${name}.ts`,'utf8')).join('\n');
 const accepted=new Set([...source.matchAll(/(?:'([a-z][a-z-]*)'|\b([a-z][a-z]*)):\s*\{\s*type:/g)].map(match=>'--'+(match[1]??match[2])));
 for(const command of cliReference){expect(help).toContain(command.command);for(const option of command.options)expect(accepted.has(option),command.command+' '+option).toBe(true);}
});
