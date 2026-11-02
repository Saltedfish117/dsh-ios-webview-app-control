import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { IosError } from './protocol.mjs';
const key=s=>createHash('sha256').update(s).digest('hex');
export class LeaseStore {
  constructor(dir,maxSeconds=120){this.dir=dir;this.maxSeconds=maxSeconds;}
  file(device){return path.join(this.dir,key(device)+'.lease.json');}
  async acquire(device,owner,seconds=60){
    if(!Number.isInteger(seconds)||seconds<5||seconds>this.maxSeconds)throw new IosError('invalid_lease_duration','Lease seconds must be 5..'+this.maxSeconds);
    await mkdir(this.dir,{recursive:true});const record={deviceHash:key(device),owner,token:randomUUID(),pid:process.pid,expiresAt:Date.now()+seconds*1000};
    let h;try{h=await open(this.file(device),'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new IosError('device_busy','Device lease exists. Do not steal expired/stale leases; verify and release its owner first.');throw e;}
    try{await h.writeFile(JSON.stringify(record));}finally{await h.close();}return record;
  }
  async read(device){try{return JSON.parse(await readFile(this.file(device),'utf8'));}catch(e){if(e.code==='ENOENT')throw new IosError('lease_required','Acquire this device first.');throw e;}}
  async assert(device,owner,token){const r=await this.read(device);if(r.owner!==owner||r.token!==token)throw new IosError('lease_not_owned','Lease belongs to another session.');if(r.expiresAt<=Date.now())throw new IosError('lease_expired','Lease expired; release your own token then acquire again.');return r;}
  async release(device,owner,token){
    const busy=this.file(device)+'.busy';let h;
    try{h=await open(busy,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new IosError('device_busy','Cannot release a lease while its command is still running.');throw e;}
    try{const r=await this.read(device);if(r.owner!==owner||r.token!==token)throw new IosError('lease_not_owned','Cannot release another session lease.');await unlink(this.file(device));return {released:true};}
    finally{await h.close();await unlink(busy).catch(()=>{});}
  }
  async withCommand(device,owner,token,callback){
    await this.assert(device,owner,token);const file=this.file(device)+'.busy';let h;
    try{h=await open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new IosError('device_busy','A command for this device is still in progress; no parallel input/read attachments.');throw e;}
    let retain=false;
    try{await h.writeFile(JSON.stringify({owner,pid:process.pid,startedAt:new Date().toISOString()}));await this.assert(device,owner,token);return await callback();}
    catch(e){retain=e.details?.retainDeviceLock===true;throw e;}
    finally{await h.close();if(!retain)await unlink(file).catch(()=>{});}
  }
}
