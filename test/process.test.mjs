import test from 'node:test';
import assert from 'node:assert/strict';
import {runPython} from '../src/core/python.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('bounded subprocess captures output without shell interpolation',async()=>{const out=await runPython(process.execPath,['-e','process.stdout.write("generic-ok")'],{timeoutMs:3000});assert.equal(out,'generic-ok');});
test('timeout terminates its owned process and waits for close',{timeout:10000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-ios-child-'));const pidFile=path.join(dir,'child.pid');
 const code='require("node:fs").writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));setInterval(()=>{},1000);';
 try{await assert.rejects(runPython(process.execPath,['-e',code],{timeoutMs:500}),{code:'process_timeout'});assert.equal(existsSync(pidFile),true);const id=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(id,0));}finally{await rm(dir,{recursive:true,force:true});}
});
test('caller abort terminates only its owned process',{timeout:10000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-ios-abort-'));const pidFile=path.join(dir,'child.pid');const ac=new AbortController();
 const code='require("node:fs").writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));setInterval(()=>{},1000);';
 const work=runPython(process.execPath,['-e',code],{signal:ac.signal,timeoutMs:5000});
 const outcome=assert.rejects(work,{code:'cancelled'});
 try{for(let i=0;i<100&&!existsSync(pidFile);i++)await wait(20);assert.equal(existsSync(pidFile),true);const id=Number(await readFile(pidFile,'utf8'));ac.abort();await outcome;assert.throws(()=>process.kill(id,0));}finally{ac.abort();await outcome;await rm(dir,{recursive:true,force:true});}
});
