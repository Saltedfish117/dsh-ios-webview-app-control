import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const forbidden=/ApiServices|access_token|login_token|\/pages\/|uni\.(?:navigateTo|redirectTo|reLaunch|switchTab)|ACT-SIGNUP|ACT-DETAIL|POWER-RANK|DEFEATED-|趣运动/;
let count=0;
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await scan(p);else if(/\.(?:mjs|json|yml|md)$/.test(p)){const text=await readFile(p,'utf8');if(forbidden.test(text))throw Error('Business/framework coupling: '+p);if(/[ \t]+$/m.test(text))throw Error('Trailing whitespace: '+p);count++;}}}
await scan('src');
await scan('docs');
const readme=await readFile('README.md','utf8');if(forbidden.test(readme))throw Error('Business/framework coupling in README');
const documents=['README.md',...(await readdir('docs')).filter(x=>x.endsWith('.md')).map(x=>'docs/'+x)];
let checkedLinks=0;
for(const document of documents){const text=await readFile(document,'utf8');for(const match of text.matchAll(/\]\(<?([^)>]+)>?\)/g)){const dest=match[1].split('#')[0];if(!dest||/^(?:https?:|[A-Z]:)/i.test(dest))continue;await stat(path.resolve(path.dirname(document),dest));checkedLinks++;}}
for(const f of ['package.json','cordis.patch.yml','README.md','THIRD_PARTY_NOTICES.md','resources/runtime-lock.json','resources/notices/provenance.json'])await stat(f);
const runtimeLock=JSON.parse(await readFile('resources/runtime-lock.json','utf8'));
if(runtimeLock.schemaVersion!==1||runtimeLock.platform!=='win32'||runtimeLock.arch!=='x64'||!runtimeLock.environments?.cp312||!runtimeLock.environments?.cp313)throw Error('Incomplete runtime lock');
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(pkg.dsh?.bundle?.patch!=='./cordis.patch.yml')throw Error('Missing DSH bundle declaration');
if(pkg.exports?.['./locale/*.json']!=='./locale/*.json'||pkg.exports?.['./icon']!=='./icon.svg'||pkg.exports?.['./client']!=='./lib/client.js')throw Error('Missing display or Client exports');
if(pkg.dsh?.client?.platform!=='web'||pkg.dsh?.client?.external?.includes('zod')!==true)throw Error('Missing Client module declaration');
for(const locale of ['en','zh']){
  const metadata=JSON.parse(await readFile('locale/'+locale+'.json','utf8')).meta;
  if(!metadata?.title?.trim()||!metadata?.description?.trim())throw Error('Incomplete '+locale+' display metadata');
}
const icon=await readFile('icon.svg','utf8');
if(Buffer.byteLength(icon)>256*1024||!/<svg\s/.test(icon)||!icon.includes('http://www.w3.org/2000/svg')||/<(?:script|foreignObject)|(?:href|src)\s*=/i.test(icon))throw Error('Unsafe or invalid SVG icon');
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
if(lock.version!==pkg.version||lock.packages[''].version!==pkg.version)throw Error('Manifest and lock version differ');
console.log(JSON.stringify({ok:true,genericFiles:count,checkedLinks,package:pkg.name,version:pkg.version,displayLocales:['en','zh'],originalIcon:true}));
