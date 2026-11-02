import { mkdir,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { IosError,assertSupported,CAPABILITIES,endpointUrl,fetchJson,targets,exactPage,Cdp,decodeImage,assertLosslessJson,normalizeError } from './protocol.mjs';
import { LeaseStore } from './leases.mjs';
import { pythonPath,runPython } from './python.mjs';
import { domAction } from './dom.mjs';
export class IosControl {
  constructor(config={},deps={}){
    this.config={timeoutMs:15000,maxLeaseSeconds:120,allowEval:false,...config};
    if(!Number.isSafeInteger(this.config.timeoutMs)||this.config.timeoutMs<1||this.config.timeoutMs>120000)throw new IosError('invalid_config','timeoutMs must be 1..120000.');
    if(!Number.isSafeInteger(this.config.maxLeaseSeconds)||this.config.maxLeaseSeconds<5||this.config.maxLeaseSeconds>600)throw new IosError('invalid_config','maxLeaseSeconds must be 5..600.');
    this.disposed=false;
    this.stateDir=path.resolve(config.stateDir||path.join(os.homedir(),'.dsh-ios-webview-app-control'));
    // Lease namespace is canonical per OS user, independent of evidence stateDir.
    this.leases=deps.leases||new LeaseStore(path.join(os.homedir(),'.dsh-ios-webview-app-control','leases'),this.config.maxLeaseSeconds);
    this.connections=new Map();this.leased=new Map();this.controllers=new Set();this.active=new Set();this.connectionBusy=new Set();
    this.run=deps.runPython||runPython;this.environment=deps.environment;this.discoverTargets=deps.targets||targets;this.fetchJson=deps.fetchJson||fetchJson;this.connectCdp=deps.connectCdp||Cdp.connect.bind(Cdp);
  }
  connection(id,owner){const c=this.connections.get(id);if(!c||c.owner!==owner)throw new IosError('connection_not_owned','Unknown connection for this session.');assertSupported(c.platform,c.appType);return c;}
  async execute(action,args={},exec={}){
    if(action==='capabilities')return {ok:true,capabilities:CAPABILITIES,authorizationGranted:false,deviceAccessPerformed:false,unsupportedMessage:'本插件仅实现 iOS WebView / 混合应用控制。android:false、nativeTap:false 等只表示本插件未实现，不是整个 DSH 会话的工具清单，也不评估其它工具、设备连接或访问权限。'};
    if(this.disposed)throw new IosError('service_disposed','Plugin has been disposed.');
    if(!exec.owner||typeof exec.owner!=='string')throw new IosError('owner_required','An owning DSH session is required.');
    const ac=new AbortController();this.controllers.add(ac);const signal=exec.signal?AbortSignal.any([exec.signal,ac.signal]):ac.signal;
    const work=this.dispatch(action,args,{...exec,signal});this.active.add(work);
    try{const result=await work;assertLosslessJson(result);return result;}catch(error){throw normalizeError(error);}finally{this.active.delete(work);this.controllers.delete(ac);}
  }
  async dispatch(action,args,{owner,signal}){
    signal.throwIfAborted();
    if(action==='devices'){
      const interpreter=this.environment?await this.environment.requirePython():pythonPath(this.config);
      const raw=await this.run(interpreter,['-I','-m','pymobiledevice3','--no-color','usbmux','list'],{signal,timeoutMs:this.config.timeoutMs});
      const list=JSON.parse(raw);if(!Array.isArray(list))throw new IosError('invalid_device_list','Expected usbmux device list.');
      return {ok:true,devices:list.map(d=>({udid:d.Identifier||d.UniqueDeviceID||null,name:d.DeviceName||null,version:d.ProductVersion||null,connectionType:d.ConnectionType||null}))};
    }
    if(action==='connect'){
      assertSupported(args.platform,args.appType); // Hard refusal before HTTP, device I/O or lease creation.
      if(typeof args.udid!=='string'||!args.udid.trim()||args.verifiedExistingUdid!==args.udid)throw new IosError('device_binding_unverified','An explicit human-confirmed verifiedExistingUdid equal to udid is required; do not infer from PID/title.');
      if(!args.endpoint&&!this.config.endpoint)throw new IosError('endpoint_required','Configure or explicitly select an existing bridge endpoint.');
      const endpoint=endpointUrl(args.endpoint||this.config.endpoint);
      const version=await this.fetchJson(endpoint,'/json/version',{signal,timeoutMs:this.config.timeoutMs});
      if(version['User-Agent']!=='pymobiledevice3')throw new IosError('wrong_bridge','Existing endpoint is not a pymobiledevice3 bridge.');
      const list=await this.discoverTargets(endpoint,{signal,timeoutMs:this.config.timeoutMs});
      signal.throwIfAborted();
      const id=randomUUID();const c={id,owner,endpoint,udid:args.udid,platform:args.platform,appType:args.appType,binding:'operator-attested',connectedAt:new Date().toISOString()};
      this.connections.set(id,c);
      return {ok:true,connectionId:id,endpoint,deviceBinding:'operator-attested-not-automatically-proven',appTypeValidation:'operator-declared-not-automatically-proven',targetCount:list.length,capabilities:CAPABILITIES,buildIdentity:'unverified',warning:'Coordinate target ownership before attaching: this bridge can take over another debugger connection. No app type can be inferred solely from presence of a WebView.'};
    }
    const c=this.connection(args.connectionId,owner);
    if(this.connectionBusy.has(c.id))throw new IosError('connection_busy','Another operation owns this connection; wait for it to settle.');
    this.connectionBusy.add(c.id);
    try{
    if(action==='disconnect'){
      const l=this.leased.get(c.id);if(l){await this.leases.release(c.udid,owner,l.token);this.leased.delete(c.id);}this.connections.delete(c.id);return {ok:true,disconnected:true,bridgeStopped:false};
    }
    if(action==='targets'){
      const list=await this.discoverTargets(c.endpoint,{signal,timeoutMs:this.config.timeoutMs});
      return {ok:true,connectionId:c.id,targets:list.map(t=>({id:t.id||null,title:t.title||null,type:t.type||null,url:t.url||null})),warning:'Exact id only. No target list ordering or numeric suffix proves foreground visibility.'};
    }
    if(action==='bind'){
      assertSupported(args.platform,args.appType);
      if(args.verifiedTargetId!==args.targetId||typeof args.targetId!=='string'||typeof args.appIdentity!=='string'||!args.appIdentity.trim()||args.appIdentity.length>256)throw new IosError('target_binding_unverified','Explicit operator confirmation of targetId, supported app type and appIdentity is required. Never infer app type from an inspectable page.');
      const list=await this.discoverTargets(c.endpoint,{signal,timeoutMs:this.config.timeoutMs});const t=exactPage(list,args.targetId,c.endpoint);signal.throwIfAborted();
      c.targetBinding={id:t.id,title:t.title||null,url:t.url||null,socket:t.webSocketDebuggerUrl,appIdentity:args.appIdentity.trim(),platform:args.platform,appType:args.appType};
      return {ok:true,targetBinding:{...c.targetBinding,socket:null},validation:'operator-attested-not-automatically-proven',warning:'Only this exact target is eligible for this plugin. New or changed targets require a new supported-app confirmation. This plugin rejects native/Flutter/Android/unknown targets; other tools are not assessed.'};
    }
    if(action==='acquire'){
      const lease=await this.leases.acquire(c.udid,owner,args.seconds??Math.min(60,this.config.maxLeaseSeconds));
      if(signal.aborted){await this.leases.release(c.udid,owner,lease.token);signal.throwIfAborted();}
      this.leased.set(c.id,lease);return {ok:true,leaseToken:lease.token,expiresAt:new Date(lease.expiresAt).toISOString(),warning:'Device-wide lease coordinates this plugin only; do not attach another DevTools/automation client concurrently.'};
    }
    if(action==='release'){
      if(this.leased.get(c.id)?.token!==args.leaseToken)throw new IosError('lease_not_owned','Lease token was not issued to this connection.');
      const result=await this.leases.release(c.udid,owner,args.leaseToken);this.leased.delete(c.id);return {ok:true,...result};
    }
    if(!['read','screenshot','eval','dom'].includes(action))throw new IosError('unsupported_action','This plugin does not implement the requested operation. Its WebView tools do not provide native/Flutter/Android control; other session tools are not assessed.');
    if(!this.leased.has(c.id))throw new IosError('lease_required','Acquire a lease for this exact connection first.');
    if(this.leased.get(c.id).token!==args.leaseToken)throw new IosError('lease_not_owned','Lease token was not issued to this connection.');
    return await this.leases.withCommand(c.udid,owner,args.leaseToken,async()=>{
      const list=await this.discoverTargets(c.endpoint,{signal,timeoutMs:this.config.timeoutMs});
      const t=exactPage(list,args.targetId,c.endpoint);
      const bound=c.targetBinding;
      if(!bound||bound.id!==t.id)throw new IosError('target_not_bound','This exact target has not been explicitly confirmed as belonging to a supported iOS WebView/hybrid app. Bind it before reading or input.');
      assertSupported(bound.platform,bound.appType);
      if(bound.title!==(t.title||null)||bound.url!==(t.url||null)||bound.socket!==t.webSocketDebuggerUrl){c.targetBinding=null;throw new IosError('target_changed','Target identity changed; re-list and explicitly rebind.');}
      if(action==='eval'&&!this.config.allowEval)throw new IosError('eval_disabled','Arbitrary JS is disabled by deployment configuration.');
      if(action==='eval'&&(typeof args.expression!=='string'||args.expression.length>100000))throw new IosError('invalid_expression','Expression must be a string up to 100000 characters.');
      const client=await this.connectCdp(t.webSocketDebuggerUrl,{signal,timeoutMs:this.config.timeoutMs});let mutationDispatched=false;
      try{
        await client.send('Runtime.enable');let data;
        if(action==='read'){
          const limit=args.limit??4000;if(!Number.isSafeInteger(limit)||limit<1||limit>20000)throw new IosError('invalid_limit','Text limit must be 1..20000.');
          const selector=JSON.stringify(args.selector||'body');
          data=await client.evaluate('(()=>{const es=document.querySelectorAll('+selector+');if(es.length!==1)throw new Error("selector must match exactly one element");return {text:(es[0].innerText||es[0].textContent||"").slice(0,'+limit+'),source:"untrusted-page-content"};})()');
        }
        if(action==='eval'){mutationDispatched=true;data=await client.evaluate(args.expression);}
        if(action==='dom'){
          if(!['click','scroll','input'].includes(args.action))throw new IosError('unsupported_dom_action','Only DOM click/scroll/standard text input are supported, not native input.');
          if(args.action!=='scroll'&&(typeof args.selector!=='string'||!args.selector))throw new IosError('selector_required','An exact unique CSS selector is required.');
          if(args.action==='input'&&(typeof args.value!=='string'||args.value.length>10000))throw new IosError('invalid_input','Text must be up to 10000 characters; passwords/payment/CAPTCHA are prohibited.');
          mutationDispatched=true;data=await client.evaluate('('+domAction.toString()+')('+JSON.stringify({action:args.action,selector:args.selector,y:args.y,value:args.value})+')');
        }
        if(action==='screenshot'){
          await client.send('Page.enable');const response=await client.send('Page.captureScreenshot',{format:'png'});const image=decodeImage(response.data);
          const dir=path.join(this.stateDir,'evidence',createHash('sha256').update(owner).digest('hex').slice(0,16));await mkdir(dir,{recursive:true});
          const file=path.join(dir,Date.now()+'-'+randomUUID()+image.ext);
          const meta={capturedAt:new Date().toISOString(),target:{id:t.id,title:t.title||null,url:t.url||null},captureKind:'webview-render',nativeDeviceScreenshot:false,buildIdentity:'unverified',mime:image.mime,bytes:image.bytes.length,sha256:image.sha256};
          signal.throwIfAborted();
          await writeFile(file,image.bytes,{flag:'wx',mode:0o600});await writeFile(file+'.json',JSON.stringify(meta,null,2),{flag:'wx',mode:0o600});
          data={file,metadataFile:file+'.json',...meta};
        }
        signal.throwIfAborted();assertLosslessJson(data);const encoded=JSON.stringify(data);if(encoded===undefined||encoded.length>250000)throw new IosError('result_too_large','Result is not JSON-safe or exceeds output bound.');
        return {ok:true,target:{id:t.id,title:t.title||null},data,captureKind:action==='screenshot'?'webview-render':null,operationKind:action,buildIdentity:'unverified',effectVerified:false};
      }catch(e){throw normalizeError(e,mutationDispatched?{operationOutcome:'unknown',advice:'Dispatched changes are not rolled back by errors/cancellation. Verify state before retry; never auto-replay submissions.'}:{});}
      finally{try{await client.close();}catch(e){throw normalizeError(e,mutationDispatched?{operationOutcome:'unknown'}:{});}}
    });
    }finally{this.connectionBusy.delete(c.id);}
  }
  async dispose(){this.disposed=true;for(const c of this.controllers)c.abort();await Promise.allSettled([...this.active]);for(const [id,l] of this.leased){const c=this.connections.get(id);if(c)await this.leases.release(c.udid,c.owner,l.token).catch(()=>{});}this.leased.clear();this.connections.clear();}
}
