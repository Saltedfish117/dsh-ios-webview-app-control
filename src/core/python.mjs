import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IosError } from './protocol.mjs';

export function isolatedPythonEnv(env=process.env){
  const clean={};
  for(const [key,value]of Object.entries(env)){
    if(/^(PYTHON|PIP|VIRTUAL_ENV|CONDA|__PYVENV_LAUNCHER__)/i.test(key))continue;
    clean[key]=value;
  }
  // Device discovery must never inherit a user's module injection settings or
  // write the host Python's bytecode/cache. Setup uses its own stricter env.
  return{...clean,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONPYCACHEPREFIX:path.join(os.homedir(),'.dsh-ios-webview-app-control','runtime','pycache')};
}
export function pythonPath(config={}, {env=process.env,platform=process.platform}={}){
  let candidate=config.pythonPath||env.DSH_IOS_PYTHON;
  if(!candidate&&env.DSH_PRIMARY_RUNTIME){
    if(!path.isAbsolute(env.DSH_PRIMARY_RUNTIME))throw new IosError('python_missing','DSH_PRIMARY_RUNTIME must be an absolute runtime payload directory.');
    candidate=path.join(env.DSH_PRIMARY_RUNTIME,'dependencies','python',platform==='win32'?'python.exe':'bin/python3');
  }
  // Harness home/cache layout is not a public API. Never guess ~/.dsh paths,
  // search PATH, launch a Store alias or install a runtime as a side effect.
  let isFile=false;
  if(typeof candidate==='string'&&path.isAbsolute(candidate)){
    try{isFile=statSync(candidate).isFile();}catch{}
  }
  if(!isFile)throw new IosError('python_missing','Configure pythonPath or DSH_IOS_PYTHON as an absolute Python interpreter with pymobiledevice3 installed, or set DSH_PRIMARY_RUNTIME to an existing payload. Use load_workspace_dependencies when available to obtain its Python path, then configure pythonPath explicitly. No automatic install or Windows Store alias.');
  return candidate;
}
export async function runPython(executable,args,{signal,timeoutMs=15000}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:isolatedPythonEnv()});
    let stdout='',stderr='',failure=null;let settled=false;
    const stop=e=>{if(!failure)failure=e;child.kill();};
    const abort=()=>stop(new IosError('cancelled','Python discovery cancelled.'));
    const timer=setTimeout(()=>stop(new IosError('process_timeout','Python discovery timed out; terminated only its owned child.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.stdout.on('data',b=>{stdout+=b.toString('utf8');if(Buffer.byteLength(stdout)>1024*1024)stop(new IosError('output_limit','Python discovery exceeded 1MiB.'));});
    child.stderr.on('data',b=>{stderr+=b.toString('utf8');if(Buffer.byteLength(stderr)>1024*1024)stop(new IosError('output_limit','Python errors exceeded 1MiB.'));});
    child.on('error',e=>{if(settled)return;settled=true;cleanup();reject(new IosError('process_error',e.message));});
    child.on('close',code=>{if(settled)return;settled=true;cleanup();if(failure)reject(failure);else if(code!==0)reject(new IosError('python_error','Device discovery failed; check Apple service, USB, Trust and Web Inspector.',{exitCode:code}));else resolve(stdout);});
  });
}
