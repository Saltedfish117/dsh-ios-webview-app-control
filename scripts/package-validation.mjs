import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

export const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url));
const REQUIRED_FILES=[
  'package.json','lib/plugin.mjs','lib/core/service.mjs','cordis.patch.yml',
  'README.md','docs/verification.md','locale/en.json','locale/zh.json','icon.svg',
  'scripts/manage-desktop.ps1','scripts/verify-package.mjs','scripts/package-validation.mjs',
  'lib/client.js','resources/runtime-lock.json','resources/notices/provenance.json','THIRD_PARTY_NOTICES.md',
];
const RUNTIME_FIELDS=[
  'name','version','type','main','exports','bin','files','engines','dependencies',
  'optionalDependencies','peerDependencies','peerDependenciesMeta','dsh','icon',
];
const PRIVATE_PARTS=new Set(['node_modules','artifacts','.runtime','evidence','.verify','.git']);
const BUSINESS_CONTENT=/\/pages\/|ApiServices|ACT-SIGNUP|ACT-DETAIL|POWER-RANK|DEFEATED-|趣运动/;

/** Match npm's archive basename, including scoped package names. */
export function archiveFilename(manifest){
  assert.match(manifest.name||'',/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,'Invalid package name');
  assert.match(manifest.version||'',/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,'Invalid package version');
  return manifest.name.replace(/^@/,'').replaceAll('/','-')+'-'+manifest.version+'.tgz';
}

export async function readProjectManifest(projectRoot=PROJECT_ROOT){
  return JSON.parse(await readFile(path.join(projectRoot,'package.json'),'utf8'));
}

export function defaultArchivePath(manifest,projectRoot=PROJECT_ROOT){
  return path.join(projectRoot,'artifacts',archiveFilename(manifest));
}

function tarString(header,start,end){
  return header.toString('utf8',start,end).replace(/\0.*$/s,'');
}

function tarOctal(header,start,end,label){
  const text=tarString(header,start,end).trim();
  assert.match(text,/^[0-7]+$/,`Invalid tar ${label}`);
  const value=parseInt(text,8);
  assert.ok(Number.isSafeInteger(value)&&value>=0,`Invalid tar ${label}`);
  return value;
}

function safeArchiveName(name,directory=false){
  assert.ok(typeof name==='string'&&!/[\\:\u0000-\u001f\u007f]/.test(name),'Unsafe archive path');
  const normalized=directory?name.replace(/\/$/,''):name;
  assert.ok(normalized==='package'||normalized.startsWith('package/'),'Archive entries must stay under package/');
  assert.ok(normalized.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe archive path');
  assert.ok(directory||normalized!=='package','Invalid archive file path');
  return normalized;
}

/** Read only ordinary npm tar files; refuse links and unsupported extensions before extraction. */
export function readPackageArchive(bytes){
  const tar=gunzipSync(bytes,{maxOutputLength:64*1024*1024});
  assert.ok(tar.length>=1024&&tar.length%512===0,'Invalid tar block length');
  const files=new Map();
  const names=new Set();
  let ended=false;
  for(let offset=0;offset+512<=tar.length;){
    const header=tar.subarray(offset,offset+512);
    if(header.every(value=>value===0)){
      assert.ok(offset+1024<=tar.length&&tar.subarray(offset).every(value=>value===0),'Invalid tar end marker');
      ended=true;
      break;
    }
    const checksum=tarOctal(header,148,156,'checksum');
    let actualChecksum=0;
    for(let index=0;index<512;index++)actualChecksum+=index>=148&&index<156?32:header[index];
    assert.equal(actualChecksum,checksum,'Tar checksum mismatch');
    const size=tarOctal(header,124,136,'size');
    const paddedSize=Math.ceil(size/512)*512;
    assert.ok(offset+512+paddedSize<=tar.length,'Invalid archive size');
    const type=header[156];
    assert.ok(type===0||type===48||type===53,'Unsupported tar entry type: only regular files and directories are accepted');
    const prefix=tarString(header,345,500);
    const rawName=(prefix?prefix+'/':'')+tarString(header,0,100);
    const name=safeArchiveName(rawName,type===53);
    const folded=name.toLowerCase();
    assert.ok(!names.has(folded),'Duplicate archive path: '+name);
    names.add(folded);
    assert.ok(names.size<=5000,'Archive contains too many entries');
    if(type===53)assert.equal(size,0,'Tar directory contains data');
    else files.set(name.slice('package/'.length),Buffer.from(tar.subarray(offset+512,offset+512+size)));
    offset+=512+paddedSize;
  }
  assert.ok(ended,'Missing tar end marker');
  return files;
}

function filePatternMatches(pattern,file){
  const clean=pattern.replace(/^\.\//,'').replace(/\/$/,'');
  if(file===clean||file.startsWith(clean+'/'))return true;
  let expression='';
  for(let index=0;index<clean.length;index++){
    const char=clean[index];
    if(char==='*'){
      if(clean[index+1]==='*'){expression+='.*';index++;}
      else expression+='[^/]*';
    }else if(char==='?')expression+='[^/]';
    else expression+=char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }
  return new RegExp('^'+expression+'$').test(file);
}

function includedByFiles(manifest,file){
  assert.ok(Array.isArray(manifest.files)&&manifest.files.every(item=>typeof item==='string'),'Manifest files must be an array of strings');
  return manifest.files.some(item=>!item.startsWith('!')&&filePatternMatches(item,file))
    &&!manifest.files.some(item=>item.startsWith('!')&&filePatternMatches(item.slice(1),file));
}

function assertManifestResources(manifest){
  archiveFilename(manifest);
  assert.ok(typeof manifest.engines?.dsh==='string'&&manifest.engines.dsh.trim(),'Manifest must declare engines.dsh');
  assert.ok(manifest.peerDependencies&&typeof manifest.peerDependencies==='object','Manifest must declare peerDependencies');
  assert.equal(manifest.dsh?.bundle?.patch,'./cordis.patch.yml','Missing DSH bundle declaration');
  assert.equal(manifest.exports?.['./locale/*.json'],'./locale/*.json','Missing locale wildcard export');
  assert.equal(manifest.exports?.['./icon'],'./icon.svg','Missing icon export');
  assert.equal(manifest.exports?.['./client'],'./lib/client.js','Missing Client export');
  assert.equal(manifest.dsh?.client?.platform,'web','Missing Client declaration');
  // Fixture packages used by packaging unit tests may be Host-only; the real
  // manifest is checked by check.mjs and the live Client tests.
  if(manifest.dsh?.client) assert.ok(Array.isArray(manifest.dsh.client.external)&&manifest.dsh.client.external.includes('zod'),'Missing Client external zod');
  assert.equal(manifest.dsh?.client?.platform,'web','Missing Client declaration');
  for(const file of REQUIRED_FILES){
    // npm always includes these two files independently of its files allowlist.
    if(file==='package.json'||file==='README.md')continue;
    assert.ok(includedByFiles(manifest,file),'Manifest files does not include '+file);
  }
}

async function localLibFiles(projectRoot){
  const files=[];
  async function walk(relative){
    for(const entry of await readdir(path.join(projectRoot,relative),{withFileTypes:true})){
      const name=relative+'/'+entry.name;
      assert.ok(!entry.isSymbolicLink(),'Local lib must not contain links: '+name);
      if(entry.isDirectory())await walk(name);
      else{assert.ok(entry.isFile(),'Local lib must contain ordinary files: '+name);files.push(name);}
    }
  }
  await walk('lib');
  return files.sort();
}

function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}

/** Read-only, fail-closed validation shared by verification, smoke and Desktop preflight. */
export async function verifyArchive(input,{projectRoot=PROJECT_ROOT}={}){
  projectRoot=path.resolve(projectRoot);
  const manifest=await readProjectManifest(projectRoot);
  const archive=path.resolve(input||defaultArchivePath(manifest,projectRoot));
  assert.equal(path.extname(archive).toLowerCase(),'.tgz','Pass a local .tgz archive');
  let bytes;
  try{bytes=await readFile(archive);}catch(error){
    if(error.code==='ENOENT')throw new Error(`Package archive not found: ${archive}. Build and pack ${manifest.name}@${manifest.version}, or pass an explicit current archive; older archives are never selected automatically.`,{cause:error});
    throw error;
  }
  const files=readPackageArchive(bytes);
  assert.ok(files.has('package.json'),'Archive is missing package.json');
  const packaged=JSON.parse(files.get('package.json').toString('utf8'));
  for(const field of RUNTIME_FIELDS)assert.deepEqual(packaged[field],manifest[field],'Archive manifest mismatch: '+field);
  assertManifestResources(manifest);
  assertManifestResources(packaged);
  for(const file of REQUIRED_FILES)assert.ok(files.has(file),'Archive is missing '+file);
  for(const locale of ['en','zh']){
    const data=JSON.parse(files.get('locale/'+locale+'.json').toString('utf8'));
    assert.ok(typeof data.meta?.title==='string'&&data.meta.title.trim(),'Missing locale meta.title: '+locale);
    assert.ok(typeof data.meta?.description==='string'&&data.meta.description.trim(),'Missing locale meta.description: '+locale);
  }
  const resourceLock=JSON.parse(files.get('resources/runtime-lock.json').toString('utf8'));
  assert.equal(resourceLock.schemaVersion,1,'Unsupported runtime lock');
  assert.ok(resourceLock.environments?.cp312&&resourceLock.environments?.cp313,'Missing host/fallback dependency locks');
  if(resourceLock.fallback){
    assert.equal(resourceLock.fallback?.version,'3.13.18','Fallback runtime drift');
    assert.equal(resourceLock.fallback?.archive?.sha256,'7369f7a35f261222a6ac8b3a87c1c88eeebee8af945d85346202591a64038dd3','Fallback runtime hash drift');
  }
  for(const [abi,environment]of Object.entries(resourceLock.environments)){
    assert.ok(environment.wheels?.some(wheel=>wheel.name==='pymobiledevice3'&&wheel.version===resourceLock.pymobiledevice3),'Missing complete dependency lock: '+abi);
    for(const asset of [environment.pip,...environment.wheels]){
      assert.match(asset.sha256,/^[a-f0-9]{64}$/,'Invalid runtime asset hash');
      assert.ok(asset.size>0&&asset.url.startsWith('https://'),'Invalid runtime asset');
    }
  }
  const notices=JSON.parse(files.get('resources/notices/provenance.json').toString('utf8'));
  for(const record of notices){
    assert.ok(!record.error,'Incomplete license record');
    const notice=files.get('resources/notices/'+record.filename);
    assert.ok(notice&&notice.length===record.bytes&&digest(notice)===record.sha256,'Missing or changed license text: '+record.filename);
  }
  const icon=files.get('icon.svg');
  assert.ok(icon.length>0&&icon.length<=256*1024,'Icon exceeds the 256KiB limit or is empty');
  const svg=icon.toString('utf8');
  assert.ok(/<svg\b[^>]*>/i.test(svg)&&(/<\/svg\s*>/i.test(svg)||/<svg\b[^>]*\/\s*>/i.test(svg)),'Icon is not SVG content');
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(svg),'External SVG declarations are not accepted');
  const expectedLib=await localLibFiles(projectRoot);
  const archivedLib=[...files.keys()].filter(file=>file.startsWith('lib/')).sort();
  assert.deepEqual(archivedLib,expectedLib,'Archive lib file list differs from local lib');
  const libHashes={};
  for(const [file,content]of files){
    assert.ok(!file.split('/').some(part=>PRIVATE_PARTS.has(part)),'Private/unexpected archive artifact: '+file);
    if(file.startsWith('lib/'))assert.ok(!BUSINESS_CONTENT.test(content.toString('utf8')),'Business/framework coupling: '+file);
    // Documentation records may legitimately change after pack/install verification.
    // Freeze executable code, configuration and display resources, not historical reports.
    const immutable=file.startsWith('lib/')||file.startsWith('resources/')||file.startsWith('scripts/')||file.startsWith('locale/')
      ||file==='icon.svg'||file==='cordis.patch.yml'||file==='requirements.txt';
    if(!immutable)continue;
    const source=await readFile(path.join(projectRoot,...file.split('/')));
    assert.ok(content.equals(source),'Archive content differs from local file: '+file);
    if(file.startsWith('lib/'))libHashes[file]=digest(content);
  }
  return {
    files,manifest,projectRoot,archive,
    summary:{ok:true,file:archive,name:packaged.name,version:packaged.version,bytes:bytes.length,
      sha256:digest(bytes),packagedFiles:files.size,entry:packaged.main,bundlePatch:packaged.dsh.bundle.patch,
      libFilesMatched:expectedLib.length,libHashes},
  };
}
