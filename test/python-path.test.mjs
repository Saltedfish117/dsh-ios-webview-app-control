import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pythonPath} from '../src/core/python.mjs';

async function payload(t,platform='win32'){
  const root=await mkdtemp(path.join(os.tmpdir(),'ios-python-path-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const interpreter=path.join(root,'dependencies','python',platform==='win32'?'python.exe':'bin/python3');
  await mkdir(path.dirname(interpreter),{recursive:true});
  await writeFile(interpreter,'test-only path fixture; never executed');
  return{root,interpreter};
}
test('explicit configured Python wins over environment and payload',()=>{
  assert.equal(pythonPath({pythonPath:process.execPath},{env:{DSH_IOS_PYTHON:'not-used',DSH_PRIMARY_RUNTIME:'not-used'}}),process.execPath);
});
test('explicit DSH_IOS_PYTHON is accepted without relying on Harness cache layout',()=>{
  assert.equal(pythonPath({},{env:{DSH_IOS_PYTHON:process.execPath}}),process.execPath);
});
for(const platform of ['win32','linux','darwin'])test('DSH_PRIMARY_RUNTIME supports an explicit payload: '+platform,async t=>{
  const f=await payload(t,platform);
  assert.equal(pythonPath({},{env:{DSH_PRIMARY_RUNTIME:f.root},platform}),f.interpreter);
});
test('no configured interpreter fails with an actionable message instead of guessing ~/.dsh',()=>{
  assert.throws(()=>pythonPath({},{env:{}}),error=>error.code==='python_missing'&&/load_workspace_dependencies/.test(error.message));
});
test('invalid explicit Python never falls back to another executable',async t=>{
  const f=await payload(t);
  for(const value of ['python','python.exe',path.join(f.root,'missing'),f.root]){
    assert.throws(()=>pythonPath({pythonPath:value},{env:{DSH_IOS_PYTHON:process.execPath,DSH_PRIMARY_RUNTIME:f.root}}),{code:'python_missing'});
  }
});
test('relative runtime payload is refused',()=>{
  assert.throws(()=>pythonPath({},{env:{DSH_PRIMARY_RUNTIME:'relative-runtime'}}),{code:'python_missing'});
});
