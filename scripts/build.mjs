import { mkdir,cp,readdir,rm,stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const output=path.resolve('lib');
if(path.dirname(output)!==process.cwd()||path.basename(output)!=='lib')throw Error('Unexpected build output path');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp('src','lib',{recursive:true});
// resources and notices remain at package root; package files includes them.
await stat('resources');
await stat('THIRD_PARTY_NOTICES.md');
async function check(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await check(p);else if(p.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',p],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}}}
await check('lib');console.log('Built and syntax-checked lib/ from src/.');
