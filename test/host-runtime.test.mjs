import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ApprovalService, {setApprovalPolicy} from '@deepseek-ai/dsh-user-approval';
import {Session} from '@deepseek-ai/dsh-session';
import * as plugin from '../src/plugin.mjs';
import {IosControl} from '../src/core/service.mjs';

// Isolated SDK integration only: no live GUI policy/answerer is changed, and
// device dispatch is replaced before any test can reach Python or a bridge.
async function host(t,{policy='ask',answerer,openTurn=true}={}){
  let dispatches=0;
  t.mock.method(IosControl.prototype,'dispatch',async action=>{
    dispatches++;
    assert.equal(action,'devices','integration tests must never dispatch target I/O');
    return{ok:true,devices:[]};
  });
  const ctx=new Context();
  const session=Session.create('isolated-sdk-integration');
  const agent={session,id:session.id};
  if(openTurn)session.append('turn/start',{turn:1});
  t.after(async()=>{await ctx.fiber.dispose();});
  await ctx.plugin(SystemPrompt,{});
  await ctx.plugin(ToolRuntime,{mode:'native'});
  await ctx.plugin(ApprovalService,{policy});
  if(answerer)ctx.on('approval/request',answerer);
  const fiber=await ctx.plugin(plugin,{});
  let seq=0;
  return{
    ctx,session,agent,fiber,dispatches:()=>dispatches,
    call(name,args={},signal=new AbortController().signal){
      return ctx.tools.execute({callId:'isolated-call-'+(++seq),name,arguments:args,agent,signal});
    },
    audit:()=>session.snapshotEvents().filter(event=>event.type.startsWith('approval/')),
  };
}

test('rc.5 real registry/prompt assemble, execute static capability, refuse unsupported app and dispose',async t=>{
  const h=await host(t,{policy:'never'});
  assert.equal(h.ctx.tools.schemas(h.agent).length,14);
  const assembly=await h.ctx.systemPrompt.assemble({scope:h.agent,agent:h.agent});
  assert.equal(assembly.tools.length,14);
  assert.ok(assembly.sections.some(section=>section.name==='tool:ios-webview-app-control'));
  const capabilities=await h.call('ios_capabilities');
  assert.equal(capabilities.isError,false);
  assert.equal(capabilities.value.capabilities.nativeTap,false);
  const unsupported=await h.call('ios_connect',{platform:'ios',appType:'flutter',endpoint:'http://127.0.0.1:9333',udid:'test',verifiedExistingUdid:'test'});
  assert.equal(unsupported.isError,true);
  assert.equal(unsupported.error.info.code,'unsupported_app_type');
  const denied=await h.call('ios_devices');
  assert.equal(denied.error.info.code,'approval_denied');
  assert.equal(h.dispatches(),0);
  assert.equal(h.audit().length,0,'adapter rejects never before requesting a grant');
  await h.fiber.dispose();
  assert.equal(h.ctx.tools.schemas(h.agent).length,0);
  const after=await h.ctx.systemPrompt.assemble({scope:h.agent,agent:h.agent});
  assert.equal(after.sections.some(section=>section.name==='tool:ios-webview-app-control'),false);
});

test('rc.5 approval records a fresh asked/decided pair for each allowed isolated device call',async t=>{
  const seen=[];
  const h=await host(t,{answerer:async req=>{seen.push(req);return'allowed-once';}});
  for(let i=0;i<2;i++){
    const result=await h.call('ios_devices');
    assert.equal(result.isError,false);
    assert.deepEqual(result.value,{ok:true,devices:[]});
  }
  assert.equal(h.dispatches(),2);
  assert.equal(seen.length,2);
  assert.ok(seen.every(req=>req.agent===h.agent&&req.signal instanceof AbortSignal));
  const audit=h.audit();
  assert.deepEqual(audit.map(e=>e.type),['approval/asked','approval/decided','approval/asked','approval/decided']);
  assert.equal(audit[0].data.id,audit[1].data.id);
  assert.equal(audit[2].data.id,audit[3].data.id);
  assert.notEqual(audit[0].data.id,audit[2].data.id);
  assert.equal(audit[0].data.callId,'isolated-call-1');
  assert.equal(audit[2].data.callId,'isolated-call-2');
  assert.equal(audit[1].data.outcome,'allowed-once');
});

for(const [label,answerer]of [['missing',undefined],['throwing',async()=>{throw Error('isolated answerer failed');}],['malformed',async()=>({allowed:true})]]){
  test('rc.5 '+label+' approval answerer fails closed and audits unavailable',async t=>{
    const h=await host(t,{answerer});
    const result=await h.call('ios_devices');
    assert.equal(result.isError,true);
    assert.equal(result.error.info.code,'approval_denied');
    assert.equal(h.dispatches(),0);
    assert.deepEqual(h.audit().map(e=>e.type),['approval/asked','approval/decided']);
    assert.equal(h.audit()[1].data.outcome,'unavailable');
  });
}

test('rc.5 idle session cannot create an uncommitted approval pair',async t=>{
  const h=await host(t,{openTurn:false,answerer:async()=>'allowed-once'});
  const result=await h.call('ios_devices');
  assert.equal(result.isError,true);
  assert.match(result.error.message,/outside an open turn/);
  assert.equal(h.audit().length,0);
  assert.equal(h.dispatches(),0);
});

test('rc.5 logged session never overrides configured ask without invoking answerer',async t=>{
  let asks=0;
  const h=await host(t,{answerer:async()=>{asks++;return'allowed-once';}});
  setApprovalPolicy(h.session,'never');
  const result=await h.call('ios_devices');
  assert.equal(result.error.info.code,'approval_denied');
  assert.equal(h.dispatches(),0);
  assert.equal(asks,0);
  assert.deepEqual(h.audit().map(e=>e.type),['approval/policy']);
});
