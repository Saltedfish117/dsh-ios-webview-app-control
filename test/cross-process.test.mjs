import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl=pathToFileURL(path.resolve('src/core/leases.mjs')).href;
function child(code){return spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe'],windowsHide:true});}
async function exit(child){const [code]=await once(child,'exit');return code;}
test('two independent processes cannot acquire the same device lease',{timeout:10000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-ios-crossprocess-'));
 const firstCode='import {LeaseStore} from '+JSON.stringify(moduleUrl)+';const s=new LeaseStore('+JSON.stringify(dir)+');const l=await s.acquire("test-device","process-one",30);console.log("READY");process.stdin.resume();process.stdin.once("data",async()=>{await s.release("test-device","process-one",l.token);process.exit(0);});';
 const a=child(firstCode);let errors='';a.stderr.on('data',b=>errors+=b);
 try{
  await Promise.race([new Promise((resolve,reject)=>{a.stdout.once('data',b=>String(b).includes('READY')?resolve():reject(Error('not ready')));a.once('error',reject);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('first lease process timeout')),5000))]);
  const b=child('import {LeaseStore} from '+JSON.stringify(moduleUrl)+';try{await new LeaseStore('+JSON.stringify(dir)+').acquire("test-device","process-two",30);process.exit(9);}catch(e){if(e.code!=="device_busy")throw e;console.log("REFUSED");}');
  b.stdout.resume();b.stderr.on('data',b=>errors+=b);assert.equal(await exit(b),0);
  const aExit=exit(a);a.stdin.write('release');assert.equal(await aExit,0,errors);
  const c=child('import {LeaseStore} from '+JSON.stringify(moduleUrl)+';const s=new LeaseStore('+JSON.stringify(dir)+');const l=await s.acquire("test-device","process-three",30);await s.release("test-device","process-three",l.token);');
  c.stdout.resume();c.stderr.on('data',b=>errors+=b);assert.equal(await exit(c),0,errors);
 }finally{if(a.exitCode===null)a.kill();await rm(dir,{recursive:true,force:true});}
});
