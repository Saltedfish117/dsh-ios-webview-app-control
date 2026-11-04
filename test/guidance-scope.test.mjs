import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/plugin.mjs';
import {IosControl} from '../src/core/service.mjs';

// Contract regression, not a claim that an LLM or a real Android device was tested.
async function host(t){
  const ctx=new Context();let asks=0,http=0;
  t.mock.method(globalThis,'fetch',async()=>{http++;throw Error('No network/device I/O in scope tests');});
  await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});
  ctx.provide('approval',{config:{policy:'never'},overrideOf:()=>undefined,request:async()=>{asks++;throw Error('No approval should be requested');}});
  await ctx.plugin(plugin,{runtime:{autoPrepare:false}});
  t.after(()=>ctx.fiber.dispose());
  const agent={session:{id:'scope-regression-session'}};let seq=0;
  return{ctx,agent,asks:()=>asks,http:()=>http,call:(name,args={})=>ctx.tools.execute({name,arguments:args,agent,callId:'scope-'+(++seq),signal:new AbortController().signal})};
}

test('capability false flags identify this plugin, not session inventory, authorization or device connectivity',async t=>{
  const h=await host(t);const result=await h.call('ios_capabilities');
  assert.equal(result.isError,false);
  const value=result.value;
  assert.equal(value.capabilities.source,'dsh-ios-webview-app-control');
  assert.equal(value.capabilities.scope,'plugin-only');
  assert.equal(value.capabilities.inventory,'not-session-inventory');
  for(const field of ['android','nativeTap','nativeSwipe','nativeScreenshot','nativeApps','flutterApps'])assert.equal(value.capabilities[field],false);
  assert.equal(value.authorizationGranted,false);assert.equal(value.deviceAccessPerformed,false);
  assert.match(value.unsupportedMessage,/只表示本插件未实现/);
  assert.equal(h.asks(),0);assert.equal(h.http(),0);
});

test('a plugin-local false flag does not mask independent declared tools or authorize them',async t=>{
  const h=await host(t);let independentCalls=0;
  h.ctx.tools.register(defineTool({name:'independent_platform_fixture',description:'Test fixture only: an independent provider, subject to its own permissions; not an installed Android controller.',parameters:{},output:{schema:{type:'json'},render:()=>[]},execute:async()=>{independentCalls++;throw Error('Not authorized or invoked by the iOS declaration');}}));
  const result=await h.call('ios_capabilities');assert.equal(result.value.capabilities.android,false);
  const assembled=await h.ctx.systemPrompt.assemble({scope:h.agent});
  assert.ok(assembled.tools.some(tool=>tool.name==='independent_platform_fixture'));
  assert.ok(h.ctx.tools.get('independent_platform_fixture',h.agent));
  const guidance=assembled.sections.find(section=>section.name==='tool:ios-webview-app-control').text;
  assert.match(guidance,/not the whole DSH session/);
  assert.match(guidance,/independently inspect|Independently inspect/);
  assert.match(guidance,/neither supplies nor disables/);
  assert.match(guidance,/USB connectivity or another conversation's success proves neither/);
  assert.equal(independentCalls,0,'capabilities never authorizes or dispatches another provider');
});

test('unsupported iOS-plugin calls still fail locally before approval and I/O',async t=>{
  const h=await host(t);
  for(const [platform,appType,code]of [['android','hybrid','unsupported_platform'],['ios','native','unsupported_app_type'],['ios','flutter','unsupported_app_type'],['ios','unknown','unsupported_app_type']]){
    for(const [name,args]of [
      ['ios_connect',{platform,appType,endpoint:'http://127.0.0.1:9333',udid:'test-only',verifiedExistingUdid:'test-only'}],
      ['ios_bind_target',{platform,appType,connectionId:'test-only',targetId:'page',verifiedTargetId:'page',appIdentity:'Operator-confirmed test-only'}],
    ]){
      const result=await h.call(name,args);assert.equal(result.isError,true);assert.equal(result.error.info.code,code);
      assert.match(result.error.message,/This plugin rejects/);assert.match(result.error.message,/other tools|Other tools/);
    }
  }
  assert.equal(h.asks(),0);assert.equal(h.http(),0);
});

test('scope clarification retains fail-closed permission and forbids rerouting the same denied operation',async t=>{
  const h=await host(t);const result=await h.call('ios_devices');
  assert.equal(result.isError,true);assert.equal(result.error.info.code,'approval_denied');
  const guidance=(await h.ctx.systemPrompt.assemble()).sections.find(section=>section.name==='tool:ios-webview-app-control').text;
  assert.match(guidance,/same denied operation via raw core\/CLI\/shell or another tool/);
  assert.match(guidance,/each such tool retains its own permissions/);
  assert.equal(h.asks(),0);assert.equal(h.http(),0);
});

test('CLI, connect capabilities and documentation retain plugin-local scope without changing device gates',async t=>{
  const cli=spawnSync(process.execPath,['src/cli.mjs','capabilities'],{encoding:'utf8',timeout:10000});
  assert.equal(cli.status,0,cli.stderr);
  const value=JSON.parse(cli.stdout);assert.equal(value.capabilities.scope,'plugin-only');assert.equal(value.capabilities.inventory,'not-session-inventory');
  const core=new IosControl({}, {fetchJson:async()=>({'User-Agent':'pymobiledevice3'}),targets:async()=>[]});
  t.after(()=>core.dispose());
  const connected=await core.execute('connect',{platform:'ios',appType:'hybrid',endpoint:'http://127.0.0.1:9333',udid:'test-only',verifiedExistingUdid:'test-only'},{owner:'test-only',signal:new AbortController().signal});
  assert.equal(connected.capabilities.scope,'plugin-only');assert.equal(connected.capabilities.android,false);
  const readme=await readFile('README.md','utf8');const guide=await readFile('docs/first-use.md','utf8');const ui=await readFile('src/client.js','utf8');
  assert.match(readme,/不是 DSH 会话的完整工具清单/);assert.match(guide,/ios_preflight/);assert.match(guide,/逐次审批/);
  assert.match(ui,/This is not a DSH\/session tool inventory/);assert.match(ui,/这不是 DSH 会话的完整工具清单/);
  for(const file of ['locale/zh.json','locale/en.json']){
    const description=JSON.parse(await readFile(file,'utf8')).meta.description;
    assert.match(description,/其它工具|other DSH tools/);
  }
});
