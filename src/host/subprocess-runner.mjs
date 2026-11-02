import {IosError} from '../core/protocol.mjs';

/** Adapter for the DSH-owned process range; never shell-interpolates argv. */
export function createManagedRunner(subprocess){
  return async function run(executable,args,{signal,timeoutMs=15000,env,cwd,onOutput}={}){
    signal?.throwIfAborted();
    const timeout=new AbortController();
    const timer=setTimeout(()=>timeout.abort(new IosError('process_timeout','Environment subprocess exceeded its deadline.')),timeoutMs);
    const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
    let handle;
    try{
      handle=subprocess.spawn({
        argv:[executable,...args],cwd,
        env,signal:combined,graceMs:3000,
        stdio:{stdin:'ignore',stdout:{maxBytes:1024*1024},stderr:{maxBytes:1024*1024}},
      });
      const outcome=await handle.done;
      const stdout=handle.collected.stdout?.readFrom(0),stderr=handle.collected.stderr?.readFrom(0);
      if(stdout?.lossy||stderr?.lossy)throw new IosError('output_limit','Environment subprocess output exceeded its bound.');
      if(stdout?.text)onOutput?.('stdout',stdout.text);
      if(stderr?.text)onOutput?.('stderr',stderr.text);
      combined.throwIfAborted();
      return{stdout:stdout?.text||'',stderr:stderr?.text||'',exitCode:outcome.exitCode??1};
    }finally{
      clearTimeout(timer);
      if(handle){
        // The provider controls its complete owned process range, including
        // descendants that inherited pipes. Join termination on every path.
        handle.terminate();
        await handle.waitForExit();
      }
    }
  };
}
