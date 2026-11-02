import { createHash } from 'node:crypto';
export class IosError extends Error {
  constructor(code,message,details={}) { super(message);this.code=code;this.details=details; }
}
export function normalizeError(error,extra={}){
  const code=typeof error?.code==='string'?error.code:(error?.name==='AbortError'?'cancelled':'operation_failed');
  const message=error instanceof Error?error.message:(typeof error==='string'?error:'Operation failed or was cancelled.');
  const details=error?.details&&Object.getPrototypeOf(error.details)===Object.prototype?error.details:{};
  return new IosError(code,message,{...details,...extra});
}
export function assertSupported(platform,appType) {
  if(platform!=='ios')throw new IosError('unsupported_platform','本插件拒绝此次非 iOS 调用：ios_* 设备工具仅接受 iOS WebView / 混合应用。本错误不评估 DSH 会话中其它工具的能力。');
  if(!['webview','hybrid'].includes(appType))throw new IosError('unsupported_app_type','本插件拒绝此应用类型：仅接受明确确认的 iOS WebView / 混合应用；不能为通过校验而改标原生、Flutter、React Native 或未知应用。本错误不评估其它工具。');
}
export const CAPABILITIES=Object.freeze({source:'dsh-ios-webview-app-control',scope:'plugin-only',inventory:'not-session-inventory',platforms:['ios'],appTypes:['webview','hybrid'],webDom:true,jsEval:'disabled-by-default',webviewScreenshot:true,nativeElementTree:false,nativeTap:false,nativeSwipe:false,nativeScreenshot:false,nativeApps:false,flutterApps:false,android:false});
export function endpointUrl(value='http://127.0.0.1:9333') {
  const u=new URL(value);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new IosError('unsafe_endpoint','Only loopback HTTP bridge origins without paths or credentials are supported.');
  u.hostname='127.0.0.1';return u.origin;
}
export function boundedSignal(signal,ms) {return signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);}
export async function fetchJson(endpoint,pathname,{signal,timeoutMs=15000}={}) {
  if(!['/json','/json/version'].includes(pathname))throw new IosError('invalid_bridge_path','Unsupported bridge discovery path.');
  const r=await fetch(endpoint+pathname,{signal:boundedSignal(signal,timeoutMs),redirect:'error'});
  if(!r.ok)throw new IosError('bridge_http_error','Bridge returned HTTP '+r.status);
  const reader=r.body.getReader();const chunks=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new IosError('result_too_large','Bridge discovery exceeded 2MiB.');}chunks.push(item.value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function assertLosslessJson(value,seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return;
  if(typeof value!=='object'||seen.has(value)||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))throw new IosError('non_json_result','Result must contain only lossless JSON values.');
  seen.add(value);
  if(Array.isArray(value)){for(let i=0;i<value.length;i++){if(!Object.hasOwn(value,i))throw new IosError('non_json_result','Sparse arrays are not lossless JSON.');assertLosslessJson(value[i],seen);}}
  else for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')throw new IosError('non_json_result','Symbol keys are not JSON.');const d=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(d,'value'))throw new IosError('non_json_result','Accessor results are not JSON.');assertLosslessJson(d.value,seen);}
  seen.delete(value);
}
export async function targets(endpoint,options){const a=await fetchJson(endpoint,'/json',options);if(!Array.isArray(a))throw new IosError('invalid_bridge','Expected a target array.');return a;}
export function exactPage(list,id,endpoint){
  const matches=list.filter(t=>t.id===id&&t.type==='page');
  if(matches.length!==1)throw new IosError('target_not_found','Exact page target is absent; list targets again. Node/JSContext is not a DOM page.');
  const t=matches[0],ws=new URL(t.webSocketDebuggerUrl),base=new URL(endpoint);
  if(ws.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(ws.hostname)||ws.port!==base.port||ws.username||ws.password)throw new IosError('unsafe_websocket','Target socket does not belong to the selected loopback bridge.');
  ws.hostname=base.hostname;return {...t,webSocketDebuggerUrl:ws.href};
}
export function remoteValue(p){
  if(p.wasThrown||p.exceptionDetails)throw new IosError('javascript_exception',p.result?.description||p.exceptionDetails?.text||'Page JavaScript threw.');
  const r=p.result;
  if(r&&Object.hasOwn(r,'value'))return r.value;
  if(r?.type==='undefined')return {type:'undefined'};
  return {type:r?.type||'unknown',description:r?.description||'',unserializableValue:r?.unserializableValue||''};
}
export function decodeImage(data){
  if(typeof data!=='string'||!data.length||data.length>40*1024*1024)throw new IosError('invalid_image','Screenshot data is empty or exceeds the 30MiB decoded bound.');
  const bytes=Buffer.from(data,'base64');let format,mime,ext;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){format='png';mime='image/png';ext='.png';}
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){format='jpeg';mime='image/jpeg';ext='.jpg';}
  else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){format='webp';mime='image/webp';ext='.webp';}
  else throw new IosError('invalid_image','Screenshot bytes are not PNG/JPEG/WebP.');
  return {bytes,format,mime,ext,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export class Cdp {
  constructor(ws,signal,timeoutMs){
    this.ws=ws;this.signal=signal;this.timeoutMs=timeoutMs;this.pending=new Map();this.seq=0;this.closed=false;this.transportClosed=false;this.closeWaiters=[];this.closePromise=null;
    ws.addEventListener('message',e=>{let m;try{m=JSON.parse(String(e.data));}catch{return;}const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);if(m.error)p.reject(new IosError('cdp_error',m.error.message||'CDP failed.'));else p.resolve(m.result||{});});
    ws.addEventListener('close',()=>{this.transportClosed=true;this.signal?.removeEventListener('abort',this.onAbort);this.rejectAll(new IosError('target_disconnected','Target disconnected; re-list before retry.'));for(const done of this.closeWaiters.splice(0))done();});
    ws.addEventListener('error',()=>this.rejectAll(new IosError('websocket_error','Bridge socket error.')));
    this.onAbort=()=>{this.rejectAll(new IosError('cancelled','Operation cancelled.'));void this.close().catch(()=>{});};
    signal?.addEventListener('abort',this.onAbort,{once:true});
  }
  static async connect(url,{signal,timeoutMs=15000,factory=u=>new WebSocket(u)}={}){
    signal?.throwIfAborted();const ws=factory(url),c=new Cdp(ws,signal,timeoutMs);
    try{await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();reject(new IosError('cancelled','Connection cancelled.'));};
      const timer=setTimeout(()=>{cleanup();reject(new IosError('connect_timeout','CDP connect timeout.'));},timeoutMs);
      ws.addEventListener('open',()=>{cleanup();resolve();},{once:true});
      ws.addEventListener('error',()=>{cleanup();reject(new IosError('websocket_error','Cannot connect CDP.'));},{once:true});
      ws.addEventListener('close',()=>{cleanup();reject(new IosError('target_disconnected','Target closed while connecting.'));},{once:true});
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });return c;}catch(e){await c.close();throw e;}
  }
  rejectAll(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
  send(method,params={}){
    this.signal?.throwIfAborted();if(this.closed||this.transportClosed)return Promise.reject(new IosError('client_closed','CDP client is closed.'));
    return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new IosError('command_timeout','Timed out: '+method));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.ws.send(JSON.stringify({id,method,params}));}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
  }
  async evaluate(expression){return remoteValue(await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true}));}
  async close(){
    if(this.closePromise)return this.closePromise;
    this.closed=true;this.signal?.removeEventListener('abort',this.onAbort);this.rejectAll(new IosError('client_closed','CDP client closed.'));
    if(this.transportClosed)return;
    this.closePromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new IosError('socket_close_unknown','Socket close was not confirmed; keep device lock until owner verifies transport shutdown.',{retainDeviceLock:true})),Math.min(this.timeoutMs,3000));
      const done=()=>{clearTimeout(timer);resolve();};this.closeWaiters.push(done);
      try{this.ws.close();}catch(e){clearTimeout(timer);reject(new IosError('socket_close_unknown','Cannot confirm socket shutdown.',{retainDeviceLock:true}));}
    });
    return this.closePromise;
  }
}
