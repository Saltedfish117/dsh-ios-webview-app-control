import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { EnvironmentManager, EnvironmentNotReadyError, validateRuntimeLock } from '../src/runtime/environment-manager.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ok = stdout => ({ stdout, stderr: '', exitCode: 0 });
function tar(name = 'python/python.exe', content = Buffer.from('fixture-pbs-python'), type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  for (const [start, width, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, content.length], [136, 12, 0]]) header.write(value.toString(8).padStart(width - 1, '0') + '\0', start, width);
  header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
  header.write(header.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return gzipSync(Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)]));
}
function lockedAssets() {
  const payloads = new Map();
  const asset = (filename, bytes, metadata = {}) => {
    const url = 'https://locked.example/' + filename;
    payloads.set(url, bytes);
    return { ...metadata, filename, url, size: bytes.length, sha256: hash(bytes) };
  };
  const pip = asset('pip-26.2.2-py3-none-any.whl', Buffer.from('locked-pip'), { name: 'pip', version: '26.2.2' });
  const wheel = asset('pymobiledevice3-11.45.0-py3-none-any.whl', Buffer.from('locked-package'), { name: 'pymobiledevice3', version: '11.45.0' });
  const environment = python => ({ python, pip, wheels: [wheel], requirements: [`pymobiledevice3==11.45.0 --hash=sha256:${wheel.sha256}`] });
  const archive = asset('cpython-3.13.18+20261026-test.tar.gz', tar());
  return { payloads, lock: { schemaVersion: 1, platform: 'win32', arch: 'x64', pymobiledevice3: '11.45.0', fallback: { version: '3.13.18', archive, rootDir: 'python', executable: 'python/python.exe' }, environments: { cp312: environment('3.12'), cp313: environment('3.13') } } };
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ios-runtime-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host = path.join(root, 'host-python.exe');
  await writeFile(host, 'mock host CPython; never executed');
  const runtimeDir = path.join(root, 'runtime');
  const { lock, payloads } = lockedAssets();
  const calls = [];
  const downloads = [];
  const state = { hostVersion: '3.12.10', fail: null, hook: null, versions: new Map() };
  const runner = async (executable, args, invocation) => {
    calls.push({ executable, args, invocation });
    if (state.hook) { const special = await state.hook(executable, args, invocation); if (special) return special; }
    if (state.fail && state.fail(executable, args)) return { stdout: '', stderr: 'mock failure', exitCode: 2 };
    if (args.includes('venv') && args.includes('--without-pip')) {
      const generation = args.at(-1);
      await mkdir(path.join(generation, 'Scripts'), { recursive: true });
      await writeFile(path.join(generation, 'Scripts', 'python.exe'), 'mock private venv; never executed');
      await writeFile(path.join(generation, 'pyvenv.cfg'), 'include-system-site-packages = false\n');
      state.versions.set(path.join(generation, 'Scripts', 'python.exe'), executable === host ? state.hostVersion : '3.13.18');
      return ok('');
    }
    if (args.includes('-c') && args.some(value => value.includes('sys.implementation.name'))) {
      const venv = executable.includes(path.sep + 'generations' + path.sep);
      const version = state.versions.get(executable) || (executable === host ? state.hostVersion : '3.13.18');
      const prefix = venv ? path.dirname(path.dirname(executable)) : path.dirname(executable);
      return ok('probe diagnostic\n' + JSON.stringify({ implementation: 'cpython', version, bits: 64, executable, prefix, basePrefix: venv ? path.join(root, 'base') : prefix }));
    }
    if (args.some(value => value.includes('importlib.metadata.version'))) return ok('11.45.0\n');
    if (args.some(value => value.includes('import venv'))) return ok('venv-ok');
    if (args.at(-1) === '--help') return ok('pymobiledevice3 CLI help');
    if (args[0] === 'query') return { stdout: '', stderr: '', exitCode: 1 };
    return ok('');
  };
  const fetch = async (url, init) => {
    downloads.push({ url, init });
    const bytes = payloads.get(url);
    assert.ok(bytes, 'only locked URLs may be downloaded');
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
  };
  const config = { pythonPath: host, runtime: { directory: runtimeDir, timeoutMs: 10000 }, ...options.config };
  const deps = { root: runtimeDir, platform: 'win32', arch: 'x64', lock, env: {}, runner, fetch, ...options.deps };
  const manager = new EnvironmentManager(config, deps);
  t.after(() => manager.dispose());
  return { root, runtimeDir, host, manager, calls, downloads, lock, payloads, state, runner, fetch, config, deps };
}

test('runtime constructor and status have no provisioning or device side effects; snapshots and subscribers are bounded copies', async t => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0);
  await assert.rejects(stat(f.runtimeDir), { code: 'ENOENT' });
  const initial = f.manager.status();
  assert.equal(initial.phase, 'unprepared'); assert.equal(initial.busy, false);
  if (initial.python) initial.python.version = 'tampered'; assert.equal(f.manager.status().python, null);
  const seen = []; const unsubscribe = f.manager.subscribe(snapshot => seen.push(snapshot));
  assert.equal(seen.length, 1); unsubscribe();
  await assert.rejects(f.manager.requirePython(), EnvironmentNotReadyError);
  assert.equal(f.downloads.length, 0, 'requirePython never calls prepare, even when autoPrepare would be true');
  assert.ok(JSON.stringify(f.manager.status()).length < 4000);
});

test('actual schemaVersion 1 lock validates every provided ABI without running Python or downloading', async () => {
  const actual = validateRuntimeLock(JSON.parse(await readFile(new URL('../resources/runtime-lock.json', import.meta.url), 'utf8')));
  assert.deepEqual(Object.keys(actual.environments), ['cp39', 'cp310', 'cp311', 'cp312', 'cp313']);
});

test('runtime picks locked explicit host CPython, creates final generation and performs only isolated local-wheel pip installs', async t => {
  const f = await fixture(t, { deps: { env: { PYTHONPATH: 'malicious', PIP_INDEX_URL: 'https://untrusted.invalid', HOME: 'outside', USERPROFILE: 'outside', TEMP: 'outside', PATH: 'C:\\untrusted;C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps' } } });
  const states = []; f.manager.subscribe(state => states.push(state));
  const ready = await f.manager.prepare();
  assert.equal(ready.phase, 'ready'); assert.equal(ready.busy, false); assert.equal(ready.python.source, 'host'); assert.equal(ready.python.abi, 'cp312');
  assert.equal(ready.python.provenance, 'config'); assert.equal(ready.pymobiledevice3, '11.45.0');
  assert.equal(ready.python.path, await f.manager.requirePython()); assert.ok(path.isAbsolute(ready.python.path));
  assert.equal(f.downloads.length, 2, 'no fallback archive is downloaded for a suitable host');
  assert.ok(states.some(snapshot => snapshot.phase === 'creating')); assert.ok(states.some(snapshot => snapshot.phase === 'installing')); assert.ok(states.some(snapshot => snapshot.phase === 'verifying'));
  assert.equal(ready.progress, null, 'a settled status must not keep reporting download progress');
  assert.equal(ready.step, '', 'a settled status must not keep reporting a preparation step');
  assert.ok(states.some(snapshot => snapshot.phase === 'downloading' && snapshot.progress?.totalBytes > 0), 'in-flight preparation still reports byte progress');
  const create = f.calls.find(call => call.args.includes('venv') && call.args.includes('--without-pip'));
  assert.ok(create); assert.ok(!create.args.includes('--system-site-packages')); assert.ok(create.args.at(-1).includes(path.sep + 'generations' + path.sep));
  for (const call of f.calls.filter(call => call.executable.endsWith('python.exe'))) {
    assert.equal(call.args[0], '-I'); assert.ok(path.isAbsolute(call.invocation.cwd));
    assert.equal(call.invocation.env.PYTHONPATH, undefined); assert.equal(call.invocation.env.PIP_INDEX_URL, undefined);
    assert.ok(!call.invocation.env.PATH.includes('untrusted')); assert.ok(!call.invocation.env.PATH.includes('WindowsApps'));
    assert.ok(call.invocation.env.HOME.startsWith(f.runtimeDir)); assert.ok(call.invocation.env.TEMP.startsWith(f.runtimeDir));
  }
  const install = f.calls.find(call => call.args.includes('--require-hashes'));
  for (const flag of ['--no-index', '--only-binary', '--no-compile', '--disable-pip-version-check', '--isolated', '--require-virtualenv', '--no-user']) assert.ok(install.args.includes(flag));
  const findLinks = install.args[install.args.indexOf('--find-links') + 1];
  assert.ok((await readdir(findLinks)).every(file => !/^[a-f0-9]{64}-/.test(file)), 'wheel filenames remain valid original filenames');
  const bootstrap = f.calls.find(call => call.args.includes('--no-deps'));
  assert.ok(bootstrap.args.at(-1).endsWith(f.lock.environments.cp312.pip.filename));
  const pointer = JSON.parse(await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8'));
  assert.equal(pointer.interpreter, ready.python.path); assert.equal(pointer.generation, path.dirname(path.dirname(ready.python.path)));
});

test('empty configured pythonPath falls back to DSH_IOS_PYTHON, ABI without a lock is not selected', async t => {
  const f = await fixture(t);
  f.manager.config.pythonPath = '';
  f.manager.env.DSH_IOS_PYTHON = f.host;
  assert.equal((await f.manager.prepare()).python.provenance, 'DSH_IOS_PYTHON');
  const f2 = await fixture(t);
  f2.state.hostVersion = '3.14.0';
  const ready = await f2.manager.prepare();
  assert.equal(ready.python.source, 'private'); assert.equal(ready.python.version, '3.13.18'); assert.equal(ready.python.abi, 'cp313');
  assert.ok(f2.downloads.some(item => item.url === f2.lock.fallback.archive.url));
});

test('ready generations are reused without asset downloads or installation, and base fingerprint changes invalidate readiness', async t => {
  const f = await fixture(t);
  const first = await f.manager.prepare(); const pointer = await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8');
  const second = new EnvironmentManager(f.config, { ...f.deps, fetch: () => { throw Error('must not download ready environment'); } });
  t.after(() => second.dispose());
  const before = f.calls.length;
  assert.equal((await second.prepare()).stage, 'reused'); assert.equal(await second.requirePython(), first.python.path);
  assert.equal(f.calls.slice(before).some(call => call.args.includes('--without-pip') || call.args.includes('install')), false);
  assert.equal(await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8'), pointer);
  await writeFile(f.host, 'changed base interpreter bytes');
  await assert.rejects(second.requirePython(), { code: 'environment_not_ready' });
});

test('failed or cancelled replacement preserves the previous ready pointer; dispose drains an owned mocked subprocess', async t => {
  const f = await fixture(t);
  const ready = await f.manager.prepare(); const oldPointer = await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8');
  f.state.fail = (executable, args) => args.includes('--no-deps');
  await assert.rejects(f.manager.prepare({ forcePrivate: true }), { code: 'runtime_command_failed' });
  assert.equal(await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8'), oldPointer);
  assert.equal(await f.manager.requirePython(), ready.python.path);
  f.state.fail = null;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  let drained = false;
  f.state.hook = async (executable, args, options) => {
    if (!args.includes('--no-deps')) return;
    started();
    await new Promise(resolve => options.signal.addEventListener('abort', () => setTimeout(() => { drained = true; resolve(); }, 10), { once: true }));
    throw Object.assign(new Error('mock-owned-child-aborted'), { name: 'AbortError' });
  };
  const work = f.manager.prepare({ forcePrivate: true }); const rejected = assert.rejects(work, { code: 'cancelled' });
  await began; await f.manager.dispose(); await rejected;
  assert.equal(drained, true); assert.equal(f.manager.status().phase, 'cancelled');
  assert.equal(await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8'), oldPointer);
  await assert.rejects(f.manager.requirePython(), { code: 'environment_not_ready' });
});

test('cross-process PID owner lock is exclusive and never steals a live owner', async t => {
  const f = await fixture(t);
  await mkdir(f.runtimeDir);
  const owner = JSON.stringify({ owner: 'dsh-ios-webview-app-control.runtime.v1', pid: process.pid, token: 'not-owned' });
  await writeFile(path.join(f.runtimeDir, 'prepare.lock'), owner);
  await assert.rejects(f.manager.prepare(), { code: 'environment_busy' });
  assert.equal(await readFile(path.join(f.runtimeDir, 'prepare.lock'), 'utf8'), owner);
  assert.equal(f.downloads.length, 0); assert.equal(f.calls.length, 0);
});

test('explicit cleanup preserves ready generation/private base and evidence/leases, removing only owned inactive generations and cache', async t => {
  const f = await fixture(t);
  const ready = await f.manager.prepare({ forcePrivate: true });
  const generation = path.dirname(path.dirname(ready.python.path));
  const pointer = JSON.parse(await readFile(path.join(f.runtimeDir, 'ready.json'), 'utf8'));
  const inactive = path.join(f.runtimeDir, 'generations', 'g-1-1234');
  await mkdir(inactive); await writeFile(path.join(inactive, 'owner.json'), JSON.stringify({ owner: 'dsh-ios-webview-app-control.runtime.v1' }));
  for (const name of ['evidence', 'leases']) { await mkdir(path.join(f.runtimeDir, name)); await writeFile(path.join(f.runtimeDir, name, 'keep'), 'keep'); }
  const foreign = path.join(f.runtimeDir, 'generations', 'foreign-generation'); await mkdir(foreign);
  await f.manager.cleanup();
  await stat(generation); await stat(pointer.base.executable); await stat(foreign);
  await assert.rejects(stat(inactive), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.runtimeDir, 'evidence', 'keep'), 'utf8'), 'keep'); assert.equal(await readFile(path.join(f.runtimeDir, 'leases', 'keep'), 'utf8'), 'keep');
  assert.equal(await f.manager.requirePython(), ready.python.path);
});

test('offline, integrity and malformed lock failures are classified before installation', async t => {
  const f = await fixture(t); f.manager.offline = true;
  await assert.rejects(f.manager.prepare(), { code: 'runtime_offline' }); assert.equal(f.downloads.length, 0);
  const corrupted = await fixture(t); corrupted.payloads.set(corrupted.lock.environments.cp312.pip.url, Buffer.from('wrong-bytes'));
  await assert.rejects(corrupted.manager.prepare(), { code: 'runtime_integrity' });
  assert.equal(corrupted.calls.some(call => call.args.includes('--without-pip')), false);
  const invalid = structuredClone(corrupted.lock); invalid.environments.cp312.requirements[0] += ' --index-url https://bad.invalid';
  assert.throws(() => validateRuntimeLock(invalid), { code: 'runtime_lock_invalid' });
  const mismatched = structuredClone(corrupted.lock); mismatched.environments.cp312.requirements[0] = 'pymobiledevice3==11.45.0 --hash=sha256:' + '0'.repeat(64);
  assert.throws(() => validateRuntimeLock(mismatched), { code: 'runtime_lock_invalid' });
});

test('unsupported host platform is refused without downloads or subprocesses', async t => {
  const f = await fixture(t, { deps: { platform: 'linux' } });
  await assert.rejects(f.manager.prepare(), { code: 'unsupported_platform' });
  assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0);
});
