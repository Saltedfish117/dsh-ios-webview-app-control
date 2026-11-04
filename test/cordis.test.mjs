import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import * as plugin from '../src/plugin.mjs';

test('real Cordis activates and disposes the plugin against explicit host seams',async()=>{
 const root=new Context();const tools=new Map(),prompts=new Map();let approvalCalls=0;
 root.provide('tools',{register(d){tools.set(d.name,d);return root.effect(()=>()=>tools.delete(d.name),'test tool');}});
 root.provide('approval',{config:{policy:'never'},overrideOf:()=>undefined,request:async()=>{approvalCalls++;throw Error('Never policy must not request');}});
 root.provide('systemPrompt',{section(s){prompts.set(s.name,s);return root.effect(()=>()=>prompts.delete(s.name),'test prompt');}});
 let fiber;
 try{fiber=await root.plugin(plugin,{});assert.equal(tools.size,14);assert.equal(prompts.size,1);const exec={agent:{session:{id:'host-test-session'}},signal:new AbortController().signal,callId:'host-test-call'};const staticResult=await tools.get('ios_capabilities').execute({},exec);assert.equal(staticResult.capabilities.nativeTap,false);await assert.rejects(tools.get('ios_devices').execute({},exec),{code:'approval_denied'});assert.equal(approvalCalls,0);}finally{await fiber?.dispose();await root.fiber.dispose();}
 assert.equal(tools.size,0);assert.equal(prompts.size,0);
});
