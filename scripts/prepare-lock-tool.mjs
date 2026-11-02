// Build-time only: fetch a hash-verified uv wheel into an owned build directory.
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('artifacts/runtime-lock-build');
await mkdir(root,{recursive:true});
const response=await fetch('https://pypi.org/pypi/uv/json',{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Cannot read uv build-tool metadata');
const metadata=await response.json();
const wheel=metadata.urls.find(file=>file.filename.endsWith('py3-none-win_amd64.whl'));
if(!wheel)throw Error('Windows x64 uv build-tool wheel unavailable');
const file=path.join(root,wheel.filename);
try{await stat(file);throw Error('Build-tool destination already exists; do not overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
const bytes=Buffer.from(await(await fetch(wheel.url,{signal:AbortSignal.timeout(120000)})).arrayBuffer());
if(bytes.length!==wheel.size||createHash('sha256').update(bytes).digest('hex')!==wheel.digests.sha256)throw Error('uv build-tool integrity mismatch');
await writeFile(file,bytes,{flag:'wx'});
await writeFile(path.join(root,'uv-provenance.json'),JSON.stringify({version:metadata.info.version,file:wheel.filename,url:wheel.url,size:wheel.size,sha256:wheel.digests.sha256,scope:'build-only; not installed into host Python'},null,2),{flag:'wx'});
console.log(JSON.stringify({wheel:file,version:metadata.info.version,sha256:wheel.digests.sha256}));
