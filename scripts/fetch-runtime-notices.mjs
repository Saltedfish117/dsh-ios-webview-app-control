// Fixed upstream license texts, not executable resources. Build-time only.
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('resources/notices');
await mkdir(root,{recursive:true});
const sources=[
  ['PYTHON-LICENSE.txt','https://raw.githubusercontent.com/python/cpython/v3.13.18/LICENSE'],
  ['PYMOBILEDEVICE3-LICENSE.txt','https://raw.githubusercontent.com/doronz88/pymobiledevice3/v11.45.0/LICENSE'],
];
const pbs=['cpython','bzip2','expat','libffi','liblzma','openssl-3','sqlite','tcl','tix','zlib'];
for(const name of pbs)sources.push(['PBS-LICENSE.'+name+'.txt','https://raw.githubusercontent.com/astral-sh/python-build-standalone/20261026/LICENSE.'+name+'.txt']);
const records=[];
for(const [filename,url]of sources){
  try{await stat(path.join(root,filename));throw Error('Existing notice requires read/review before replace: '+filename);}catch(error){if(error.code!=='ENOENT')throw error;}
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok){records.push({filename,url,error:'HTTP '+response.status});continue;}
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length||bytes.length>512*1024)throw Error('Invalid notice size');
  await writeFile(path.join(root,filename),bytes,{flag:'wx'});
  records.push({filename,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(root,'provenance.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(records,null,2));
