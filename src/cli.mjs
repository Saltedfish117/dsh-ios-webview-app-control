#!/usr/bin/env node
import {IosControl} from './core/service.mjs';
import {EnvironmentManager} from './runtime/environment-manager.mjs';
const command=process.argv[2]||'help';
const print=value=>console.log(JSON.stringify(value,null,2));
if(command==='capabilities'){
  const service=new IosControl();
  try{print(await service.execute('capabilities'));}finally{await service.dispose();}
}else if(command==='environment'){
  const action=process.argv[3]||'status';
  const options=process.argv.slice(4);
  const allowed=new Set(['--directory','--python','--offline','--private','--yes']);
  const config={runtime:{}};let forcePrivate=false,confirmed=false;
  for(let index=0;index<options.length;index++){
    const key=options[index];if(!allowed.has(key))throw Error('Unknown environment option: '+key);
    if(key==='--directory'||key==='--python'){
      const value=options[++index];if(!value||value.startsWith('--'))throw Error('Missing option value: '+key);
      if(key==='--directory')config.runtime.directory=value;else config.pythonPath=value;
    }else if(key==='--offline')config.runtime.offline=true;
    else if(key==='--private')forcePrivate=true;
    else if(key==='--yes')confirmed=true;
  }
  if(!['status','prepare','cleanup'].includes(action))throw Error('Environment CLI supports status, prepare and cleanup only.');
  if(action==='cleanup'&&!confirmed)throw Error('Cleanup requires --yes and removes unused plugin-owned runtime resources only.');
  const environment=new EnvironmentManager(config);
  const controller=new AbortController();
  const cancel=()=>{controller.abort();environment.cancel();};
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{
    if(action==='prepare'){
      let previous='';
      environment.subscribe(state=>{
        const line=[state.phase,state.step].filter(Boolean).join(': ');
        if(line!==previous){process.stderr.write(line+'\n');previous=line;}
      });
      print(await environment.prepare({signal:controller.signal,forcePrivate}));
    }else if(action==='cleanup')print(await environment.cleanup({signal:controller.signal}));
    else print(environment.status());
  }catch(error){
    print({ok:false,error:{code:error.code||'environment_error',message:error.message},state:environment.status()});
    process.exitCode=1;
  }finally{
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    await environment.dispose();
  }
}else if(command==='help'){
  console.log('dsh-ios-webview-app-control capabilities\ndsh-ios-webview-app-control environment status\ndsh-ios-webview-app-control environment prepare [--python ABSOLUTE_PATH] [--directory ABSOLUTE_PATH] [--offline] [--private]\ndsh-ios-webview-app-control environment cleanup --yes [--directory ABSOLUTE_PATH]\nEnvironment preparation installs only private dependencies. Device operations remain DSH approval-gated. This plugin handles only iOS WebView/hybrid targets. Its capabilities are plugin-only, not a DSH/session tool inventory; independently inspect other available tools and their permissions for other tasks.');
}else{
  console.error('Unsupported CLI operation. Use DSH plugin tools with per-call approval for device access.');
  process.exitCode=1;
}
