import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import assert from 'node:assert/strict';
import {verifyArchive} from './package-validation.mjs';

if(process.argv.length>3)throw new Error('Usage: node scripts/smoke-package.mjs [archive.tgz]');
// Validate the exact current package before extracting or importing any archive code.
const verified=await verifyArchive(process.argv[2]);
const modules=path.join(verified.projectRoot,'node_modules');
const dir=await mkdtemp(path.join(modules,'.ios-package-smoke-'));
try{
  for(const [relative,content]of verified.files){
    const dest=path.resolve(dir,...relative.split('/'));
    assert.ok(dest.startsWith(dir+path.sep),'Unsafe archive extraction path');
    await mkdir(path.dirname(dest),{recursive:true});
    await writeFile(dest,content,{flag:'wx'});
  }
  const plugin=await import(pathToFileURL(path.join(dir,'lib','plugin.mjs')).href);
  const ctx=new Context(),registered=new Map(),sections=new Map();
  ctx.provide('tools',{register(definition){
    registered.set(definition.name,definition);
    return ctx.effect(()=>()=>registered.delete(definition.name),'tarball tool');
  }});
  ctx.provide('approval',{
    config:{policy:'never'},
    request:async()=>{throw Error('Never policy requested approval');},
  });
  ctx.provide('systemPrompt',{section(section){
    sections.set(section.name,section);
    return ctx.effect(()=>()=>sections.delete(section.name),'tarball prompt');
  }});
  let fiber;
  try{
    fiber=await ctx.plugin(plugin,{});
    assert.equal(registered.size,13);
    const exec={agent:{session:{id:'package-smoke-session'}},signal:new AbortController().signal,callId:'package-smoke-call'};
    const staticResult=await registered.get('ios_capabilities').execute({},exec);
    assert.equal(staticResult.capabilities.nativeTap,false);
    await assert.rejects(registered.get('ios_connect').execute({
      platform:'ios',appType:'flutter',udid:'example',verifiedExistingUdid:'example',endpoint:'http://127.0.0.1:9333',
    },exec),{code:'unsupported_app_type'});
    await assert.rejects(registered.get('ios_devices').execute({},exec),{code:'approval_denied'});
  }finally{
    await fiber?.dispose();
    await ctx.fiber.dispose();
  }
  assert.equal(registered.size,0);
  assert.equal(sections.size,0);
  console.log(JSON.stringify({
    ok:true,archive:verified.archive,version:verified.manifest.version,archiveValidated:true,
    libFilesMatched:verified.summary.libFilesMatched,actualTarballImport:true,registeredTools:13,
    nativeFlutterRefused:true,neverPolicyRefused:true,disposed:true,deviceAccess:false,
  },null,2));
}finally{
  if(path.dirname(dir)!==modules||!path.basename(dir).startsWith('.ios-package-smoke-'))throw Error('Unexpected smoke cleanup path');
  await rm(dir,{recursive:true,force:true});
}
