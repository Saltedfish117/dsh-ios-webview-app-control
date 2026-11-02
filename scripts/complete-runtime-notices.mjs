import{readFile,writeFile,stat}from'node:fs/promises';
import{createHash}from'node:crypto';
import path from'node:path';
const root=path.resolve('resources/notices');
const provenance=JSON.parse(await readFile(path.join(root,'provenance.json'),'utf8'));
const listing=await(await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/contents?ref=20261026',{headers:{'User-Agent':'dsh-ios-plugin-build'}})).json();
for(const item of listing.filter(x=>/^LICENSE\..*\.txt$/.test(x.name))){
  const filename='PBS-'+item.name;
  if(provenance.some(p=>p.filename===filename))continue;
  try{await stat(path.join(root,filename));throw Error('Unrecorded existing notice');}catch(e){if(e.code!=='ENOENT')throw e;}
  const url='https://raw.githubusercontent.com/astral-sh/python-build-standalone/20261026/'+item.name;
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Notice download failed');
  const b=Buffer.from(await r.arrayBuffer());await writeFile(path.join(root,filename),b,{flag:'wx'});
  provenance.push({filename,url,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
}
await writeFile(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({noticeFiles:provenance.length,scope:'fixed release texts; original package licensing unchanged'}));
