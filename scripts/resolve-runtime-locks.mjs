// Build-only dependency resolution; writes only under artifacts/runtime-lock-build.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('artifacts/runtime-lock-build');
const provenance=JSON.parse(await readFile(path.join(root,'uv-provenance.json'),'utf8'));
const uv=path.join(root,'uv-tool',`uv-${provenance.version}.data`,'scripts','uv.exe');
const results=[];
for(const minor of [9,10,11,12,13,14]){
  if(minor===12){results.push({python:'3.12',exitCode:0,source:'already generated'});continue;}
  const abi='cp3'+minor;
  const args=['--no-config','--no-progress','pip','compile','requirements.txt','--python-version','3.'+minor,'--python-platform','x86_64-pc-windows-msvc','--only-binary',':all:','--generate-hashes','--no-annotate','--no-header','--format','pylock.toml','--output-file',path.join(root,'pylock.'+abi+'.toml'),'--cache-dir',path.join(root,'cache'),'--no-python-downloads','--default-index','https://pypi.org/simple','--quiet'];
  const outcome=await new Promise((resolve,reject)=>{
    const child=spawn(uv,args,{stdio:'inherit',windowsHide:true,shell:false,env:{...process.env,UV_PYTHON_DOWNLOADS:'never'}});
    const timer=setTimeout(()=>{child.kill();},120000);
    child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  results.push({python:'3.'+minor,exitCode:outcome});
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(path.join(root,'resolution-results.json'),JSON.stringify(results,null,2));
if(!results.find(item=>item.python==='3.13'&&item.exitCode===0))throw Error('Fallback Python has no resolved binary-only closure');
