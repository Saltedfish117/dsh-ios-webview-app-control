import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {PROJECT_ROOT,archiveFilename,defaultArchivePath,readPackageArchive,verifyArchive} from '../scripts/package-validation.mjs';

function manifest(){
  return {
    name:'fixture-ios-control',version:'0.1.2',type:'module',main:'./lib/plugin.mjs',
    exports:{'.':'./lib/plugin.mjs','./core':'./lib/core/service.mjs','./client':'./lib/client.js','./locale/*.json':'./locale/*.json','./icon':'./icon.svg'},
    bin:{'fixture-ios-control':'./lib/cli.mjs'},
    files:['lib/','resources/','THIRD_PARTY_NOTICES.md','cordis.patch.yml','README.md','docs/','locale/*.json','icon.svg','scripts/'],
    engines:{node:'>=22.18.0',dsh:'>=0.2.1-rc.5 <0.3.0'},
    peerDependencies:{'@deepseek-ai/dsh-tools':'^0.2.1-rc.5','@deepseek-ai/cordis':'~4.0.5'},
    dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web',immediately:true,external:['zod']}}, 
  };
}

function fixtureFiles(pkg){
  return new Map([
    ['package.json',Buffer.from(JSON.stringify(pkg,null,2))],
    ['lib/plugin.mjs',Buffer.from('export function apply() {}\n')],
    ['resources/runtime-lock.json',Buffer.from(JSON.stringify({schemaVersion:1,platform:'win32',arch:'x64',pymobiledevice3:'11.45.0',fallback:{version:'3.13.18',rootDir:'python',executable:'python/python.exe',archive:{filename:'fallback.tar.gz',url:'https://example.com/fallback.tar.gz',size:1,sha256:'0'.repeat(64)}},environments:{cp312:{python:'3.12',pip:{name:'pip',version:'1',filename:'pip.whl',url:'https://example.com/pip.whl',size:1,sha256:'1'.repeat(64)},wheels:[{name:'pymobiledevice3',version:'11.45.0',filename:'pym.whl',url:'https://example.com/pym.whl',size:1,sha256:'2'.repeat(64)}],requirements:['pymobiledevice3==11.45.0 --hash=sha256:'+'2'.repeat(64)]},cp313:{python:'3.13',pip:{name:'pip',version:'1',filename:'pip.whl',url:'https://example.com/pip.whl',size:1,sha256:'1'.repeat(64)},wheels:[{name:'pymobiledevice3',version:'11.45.0',filename:'pym.whl',url:'https://example.com/pym.whl',size:1,sha256:'2'.repeat(64)}],requirements:['pymobiledevice3==11.45.0 --hash=sha256:'+'2'.repeat(64)]}}}))],
    ['resources/notices/provenance.json',Buffer.from('[]\n')],
    ['THIRD_PARTY_NOTICES.md',Buffer.from('# notices\n')],
    ['lib/core/service.mjs',Buffer.from('export class IosControl {}\n')],
    ['lib/cli.mjs',Buffer.from('console.log("static");\n')],
    ['lib/client.js',Buffer.from('// Client fixture\n')],
    ['lib/runtime/environment-manager.mjs',Buffer.from('// Runtime fixture\n')],
    ['lib/runtime/errors.mjs',Buffer.from('// Runtime fixture\n')],
    ['lib/runtime/runner.mjs',Buffer.from('// Runtime fixture\n')],
    ['lib/runtime/safe-tar.mjs',Buffer.from('// Runtime fixture\n')],
    ['lib/host/environment-service.mjs',Buffer.from('// Host fixture\n')],
    ['lib/host/subprocess-runner.mjs',Buffer.from('// Host fixture\n')],
    ['lib/typert-environment.mjs',Buffer.from('// Typert fixture\n')],
    ['lib/runtime/environment-manager.mjs',Buffer.from('// Runtime fixture\n')],
    ['lib/host/environment-service.mjs',Buffer.from('// Host fixture\n')],
    ['resources/runtime-lock.json',Buffer.from(JSON.stringify({schemaVersion:1,pymobiledevice3:'11.45.0',environments:Object.fromEntries(['cp312','cp313'].map(abi=>[abi,{pip:{sha256:'1'.repeat(64),size:1,url:'https://example.com/pip.whl'},wheels:[{name:'pymobiledevice3',version:'11.45.0',sha256:'2'.repeat(64),size:1,url:'https://example.com/pym.whl'}]}]))}))],
    ['resources/notices/provenance.json',Buffer.from('[]')],
    ['THIRD_PARTY_NOTICES.md',Buffer.from('# Fixture notices\n')],
    ['cordis.patch.yml',Buffer.from('- insert: []\n')],
    ['README.md',Buffer.from('# Fixture\n')],
    ['docs/verification.md',Buffer.from('# Test-only verification\n')],
    ['locale/en.json',Buffer.from(JSON.stringify({meta:{title:'iOS control',description:'Controls inspectable WebViews.'}}))],
    ['locale/zh.json',Buffer.from(JSON.stringify({meta:{title:'iOS 控制',description:'控制可检查的 WebView。'}}))],
    ['icon.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h10v10H1z"/></svg>')],
    ['scripts/manage-desktop.ps1',Buffer.from('# Fixture\n')],
    ['scripts/verify-package.mjs',Buffer.from('// Fixture\n')],
    ['scripts/package-validation.mjs',Buffer.from('// Fixture\n')],
  ]);
}

function tarHeader(name,size,type='0'){
  const header=Buffer.alloc(512);
  header.write(name,0,100,'utf8');
  for(const [start,width,value]of [[100,8,0o644],[108,8,0],[116,8,0],[124,12,size],[136,12,0]]){
    header.write(value.toString(8).padStart(width-1,'0')+'\0',start,width,'ascii');
  }
  header.fill(32,148,156);
  header.write(type,156,1,'ascii');
  header.write('ustar\0',257,6,'ascii');
  header.write('00',263,2,'ascii');
  const checksum=header.reduce((sum,byte)=>sum+byte,0);
  header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  return header;
}

function makeArchive(files){
  const chunks=[];
  for(const [file,content]of files){
    const bytes=Buffer.from(content);
    chunks.push(tarHeader('package/'+file,bytes.length),bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

async function fixture(t,{changeManifest,changeArchive}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'ios-packaging-test-'));
  const expectedParent=path.resolve(os.tmpdir());
  t.after(async()=>{
    assert.equal(path.dirname(root),expectedParent);
    assert.ok(path.basename(root).startsWith('ios-packaging-test-'));
    await rm(root,{recursive:true,force:true});
  });
  const pkg=manifest();
  if(changeManifest)changeManifest(pkg);
  const local=fixtureFiles(pkg);
  for(const [file,bytes]of local){
    await mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await writeFile(path.join(root,file),bytes);
  }
  const archived=new Map(local);
  if(changeArchive)changeArchive(archived,pkg);
  const archive=defaultArchivePath(pkg,root);
  await mkdir(path.dirname(archive),{recursive:true});
  await writeFile(archive,makeArchive(archived));
  return {root,pkg,archive,local,archived};
}

function changePackedManifest(files,change){
  const pkg=JSON.parse(files.get('package.json').toString());
  change(pkg);
  files.set('package.json',Buffer.from(JSON.stringify(pkg)));
}

test('default archive name derives from package identity, including scopes',()=>{
  assert.equal(archiveFilename({name:'dsh-ios-webview-app-control',version:'9.8.7'}),'dsh-ios-webview-app-control-9.8.7.tgz');
  assert.equal(archiveFilename({name:'@local/ios-control',version:'1.2.3-rc.1'}),'local-ios-control-1.2.3-rc.1.tgz');
  assert.throws(()=>archiveFilename({name:'../unsafe',version:'1.0.0'}),/Invalid package name/);
  assert.throws(()=>archiveFilename({name:'safe',version:'../unsafe'}),/Invalid package version/);
});

test('default package validates complete resources and exact lib content',async t=>{
  const f=await fixture(t);
  const result=await verifyArchive(undefined,{projectRoot:f.root});
  assert.equal(result.archive,f.archive);
  assert.equal(result.summary.version,f.pkg.version);
  assert.equal(result.summary.libFilesMatched,11);
  assert.equal(result.summary.libHashes['lib/plugin.mjs'],createHash('sha256').update(f.local.get('lib/plugin.mjs')).digest('hex'));
});

test('explicit archive location is supported without relaxing identity checks',async t=>{
  const f=await fixture(t);
  const archive=path.join(f.root,'explicit-current.tgz');
  await writeFile(archive,makeArchive(f.archived));
  assert.equal((await verifyArchive(archive,{projectRoot:f.root})).summary.version,f.pkg.version);
});

test('missing default archive reports exact expected version and never falls back',async t=>{
  const f=await fixture(t);
  await rm(f.archive);
  await writeFile(path.join(path.dirname(f.archive),'fixture-ios-control-0.1.0.tgz'),makeArchive(f.archived));
  await assert.rejects(verifyArchive(undefined,{projectRoot:f.root}),/Package archive not found:.*0\.1\.2\.tgz.*older archives are never selected automatically/);
});

for(const field of ['name','version','engines','peerDependencies','exports','files']){
  test('rejects packed manifest drift: '+field,async t=>{
    const f=await fixture(t,{changeArchive(files){
      changePackedManifest(files,pkg=>{
        if(field==='name')pkg.name='other-package';
        if(field==='version')pkg.version='0.1.0';
        if(field==='engines')pkg.engines.dsh='0.2.1-rc.3';
        if(field==='peerDependencies')pkg.peerDependencies['@deepseek-ai/dsh-tools']='0.2.1-rc.3';
        if(field==='exports')delete pkg.exports['./icon'];
        if(field==='files')pkg.files=['lib/'];
      });
    }});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),new RegExp('Archive manifest mismatch: '+field));
  });
}

for(const required of ['locale/en.json','locale/zh.json','icon.svg','scripts/package-validation.mjs']){
  test('rejects missing packed resource: '+required,async t=>{
    const f=await fixture(t,{changeArchive(files){files.delete(required);}});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Archive is missing/);
  });
}

test('requires locales and icon in export/file declarations, even when archive has bytes',async t=>{
  for(const kind of ['export','files']){
    const f=await fixture(t,{changeManifest(pkg){
      if(kind==='export')delete pkg.exports['./locale/*.json'];
      else pkg.files=pkg.files.filter(file=>file!=='locale/*.json');
    }});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Missing locale wildcard export|Manifest files does not include locale\/en\.json/);
  }
});

test('requires localized title/description and SVG image bytes',async t=>{
  for(const kind of ['locale','icon']){
    const f=await fixture(t,{changeArchive(files){
      if(kind==='locale')files.set('locale/en.json',Buffer.from('{"meta":{"title":"","description":""}}'));
      else files.set('icon.svg',Buffer.from('not an image'));
    }});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Missing locale meta.title|Icon is not SVG content/);
  }
});

test('rejects stale lib bytes, extra lib files and omitted lib files',async t=>{
  for(const kind of ['stale','extra','missing']){
    const f=await fixture(t,{changeArchive(files){
      if(kind==='stale')files.set('lib/plugin.mjs',Buffer.from('export function apply(){throw Error("stale");}\n'));
      if(kind==='extra')files.set('lib/old-entry.mjs',Buffer.from('// obsolete\n'));
      if(kind==='missing')files.delete('lib/cli.mjs');
    }});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Archive content differs from local file: lib\/plugin\.mjs|Archive lib file list differs/);
  }
});

test('rejects changed patch and management script bytes',async t=>{
  for(const file of ['cordis.patch.yml','scripts/manage-desktop.ps1']){
    const f=await fixture(t,{changeArchive(files){files.set(file,Buffer.from('# obsolete\n'));}});
    await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Archive content differs from local file/);
  }
});

test('documentation may change after packing without invalidating executable verification',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.root,'docs/verification.md'),'# Updated post-install evidence\n');
  await writeFile(path.join(f.root,'README.md'),'# Updated installation notes\n');
  assert.equal((await verifyArchive(f.archive,{projectRoot:f.root})).summary.ok,true);
});

test('rejects private files even when a local file of that name exists',async t=>{
  const f=await fixture(t,{changeArchive(files){files.set('artifacts/private.json',Buffer.from('{}'));}});
  await assert.rejects(verifyArchive(f.archive,{projectRoot:f.root}),/Private\/unexpected archive artifact/);
});

test('tar reader rejects traversal, duplicate paths, symbolic links and corrupt headers',()=>{
  assert.throws(()=>readPackageArchive(makeArchive(new Map([['../escape',Buffer.from('x')]]))),/Unsafe archive path/);
  const duplicate=Buffer.concat([
    tarHeader('package/a',1),Buffer.from('a'),Buffer.alloc(511),
    tarHeader('package/A',1),Buffer.from('b'),Buffer.alloc(511),Buffer.alloc(1024),
  ]);
  assert.throws(()=>readPackageArchive(gzipSync(duplicate)),/Duplicate archive path/);
  assert.throws(()=>readPackageArchive(gzipSync(Buffer.concat([tarHeader('package/link',0,'2'),Buffer.alloc(1024)]))),/Unsupported tar entry type/);
  const corrupt=Buffer.concat([tarHeader('package/a',0),Buffer.alloc(1024)]);
  corrupt[0]^=1;
  assert.throws(()=>readPackageArchive(gzipSync(corrupt)),/Tar checksum mismatch/);
});

test('Desktop management stays on official CLI with mandatory current-archive preflight',async()=>{
  const script=await readFile(path.join(PROJECT_ROOT,'scripts/manage-desktop.ps1'),'utf8');
  assert.ok(script.includes("$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json"));
  assert.ok(script.includes("$archiveName=($packageName -replace '^@','' -replace '/','-')+'-'+$packageVersion+'.tgz'"));
  assert.ok(script.includes("& $DesktopExe $verify '--check-only' $file.FullName"));
  assert.ok(script.includes("$arguments=@($cli,'plugin','--profile','desktop')"));
  assert.ok(script.includes("$arguments+=@('add',$file.FullName,'--ignore-scripts')"));
  assert.ok(script.indexOf("& $DesktopExe $verify")<script.indexOf('& $DesktopExe @arguments'));
  assert.ok(script.includes('if($CheckOnly){return}'));
  assert.ok(!/0\.1\.0\.tgz|Set-Content|Add-Content|WriteAllText/.test(script));
});

test('verify --check-only does not create hash sidecar; ordinary verification does',async t=>{
  const f=await fixture(t);
  for(const file of ['verify-package.mjs','package-validation.mjs']){
    const source=await readFile(path.join(PROJECT_ROOT,'scripts',file));
    await writeFile(path.join(f.root,'scripts',file),source);
    f.archived.set('scripts/'+file,source);
  }
  await writeFile(f.archive,makeArchive(f.archived));
  const entry=path.join(f.root,'scripts/verify-package.mjs');
  let run=spawnSync(process.execPath,[entry,'--check-only'],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).version,f.pkg.version);
  await assert.rejects(stat(f.archive+'.sha256'),{code:'ENOENT'});
  run=spawnSync(process.execPath,[entry,f.archive],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.match(await readFile(f.archive+'.sha256','utf8'),new RegExp('^[a-f0-9]{64}  '+archiveFilename(f.pkg).replaceAll('.','\\.')+'\\n$'));
});
