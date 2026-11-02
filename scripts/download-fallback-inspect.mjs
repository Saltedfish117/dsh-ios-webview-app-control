import{readFile,writeFile,mkdir,stat}from'node:fs/promises';
import{createHash}from'node:crypto';
import{gunzipSync}from'node:zlib';
import path from'node:path';
const lock=JSON.parse(await readFile('resources/runtime-lock.json','utf8'));
const a=lock.fallback.archive;
const root=path.resolve('artifacts/runtime-lock-build');await mkdir(root,{recursive:true});
const file=path.join(root,a.filename);
let bytes;try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!bytes){
 const r=await fetch(a.url,{signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error('Python download HTTP '+r.status);
 bytes=Buffer.from(await r.arrayBuffer());
 if(bytes.length!==a.size||createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw Error('Python integrity failed');
 await writeFile(file,bytes,{flag:'wx'});
}
if(bytes.length!==a.size||createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw Error('Cached Python integrity failed');
const tar=gunzipSync(bytes,{maxOutputLength:512*1024*1024});
let count=0;const types={};const samples=[];const licenses=[];
for(let offset=0;offset+512<=tar.length;){
 const h=tar.subarray(offset,offset+512);if(h.every(x=>x===0))break;
 const str=(s,e)=>h.toString('utf8',s,e).replace(/\0.*$/s,'');
 const name=str(0,100),type=String.fromCharCode(h[156]||48),size=parseInt(str(124,136).trim()||'0',8);
 types[type]=(types[type]||0)+1;count++;
 if(samples.length<12||/python\.exe$/.test(name))samples.push({name,type,size});
 if(/licen[cs]e|notice/i.test(name))licenses.push(name);
 offset+=512+Math.ceil(size/512)*512;
}
const summary={file,compressedBytes:bytes.length,unpackedTarBytes:tar.length,count,types,samples,licenses};
await writeFile(path.join(root,'fallback-archive-inspection.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
