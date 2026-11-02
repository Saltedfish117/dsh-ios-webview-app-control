import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import {Session} from '@deepseek-ai/dsh-session';
import {EnvironmentManager} from '../src/runtime/environment-manager.mjs';
import * as plugin from '../src/plugin.mjs';

const state={phase:'unprepared',busy:false,step:'not-prepared',python:null,progress:null,pymobiledevice3:'11.45.0',runtimeDir:'test-owned',error:null};
async function fixture(t,{mode,policy='never',outcome='allowed-once'}={}){
  let prepares=0,cleanups=0,asks=0;
  t.mock.method(EnvironmentManager.prototype,'status',()=>({...state}));
  t.mock.method(EnvironmentManager.prototype,'prepare',async()=>{prepares++;return{...state,phase:'ready'};});
  t.mock.method(EnvironmentManager.prototype,'cleanup',async()=>{cleanups++;return{...state};});
  const ctx=new Context();t.after(()=>ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});await ctx.plugin(ApprovalService,{policy});
  if(mode)ctx.provide('sandboxPolicy',{resolve:()=>({mode,workspaceRoot:process.cwd()})});
  ctx.on('approval/request',async()=>{asks++;return outcome;});
  await ctx.plugin(plugin,{runtime:{autoPrepare:false}});
  const session=Session.create('environment-tool-isolation');session.append('turn/start',{turn:1});
  const agent={session,id:session.id};let id=0;
  return{ctx,session,prepares:()=>prepares,cleanups:()=>cleanups,asks:()=>asks,
    call:args=>ctx.tools.execute({name:'ios_environment',arguments:args,callId:'env-'+(++id),agent,signal:new AbortController().signal})};
}
test('environment status does not request approval or start any preparation',async t=>{
  const h=await fixture(t);const r=await h.call({action:'status'});
  assert.equal(r.isError,false);assert.equal(r.value.phase,'unprepared');
  assert.equal(h.prepares(),0);assert.equal(h.asks(),0);
});
test('never and confined mode deny environment modifications before dispatch',async t=>{
  const h=await fixture(t,{mode:'read-only'});
  for(const action of ['prepare','cleanup','cancel']){
    const r=await h.call({action});assert.equal(r.isError,true);assert.equal(r.error.info.code,'approval_denied');
  }
  assert.equal(h.prepares(),0);assert.equal(h.cleanups(),0);assert.equal(h.asks(),0);
});
test('Full access authorizes environment setup but does not change device policy',async t=>{
  const h=await fixture(t,{mode:'danger-full-access'});
  assert.equal((await h.call({action:'prepare'})).isError,false);
  assert.equal(h.prepares(),1);assert.equal(h.asks(),0);
  assert.equal(h.session.snapshotEvents().some(event=>event.type==='approval/policy'),false);
});
test('confined setup needs a fresh once-only grant for every operation',async t=>{
  const h=await fixture(t,{mode:'workspace-write',policy:'ask'});
  assert.equal((await h.call({action:'prepare'})).isError,false);
  assert.equal((await h.call({action:'cleanup'})).isError,false);
  assert.equal(h.prepares(),1);assert.equal(h.cleanups(),1);assert.equal(h.asks(),2);
  assert.deepEqual(h.session.snapshotEvents().filter(e=>e.type==='approval/decided').map(e=>e.data.outcome),['allowed-once','allowed-once']);
});
test('wire arguments cannot override a download URL, interpreter or runtime path',async t=>{
  const h=await fixture(t,{mode:'danger-full-access'});
  for(const key of ['url','pythonPath','directory','approved','owner']){
    const r=await h.call({action:'prepare',[key]:'untrusted'});
    assert.equal(r.isError,true);assert.equal(r.error.info.code,'invalid_arguments');
  }
  assert.equal(h.prepares(),0);
});
