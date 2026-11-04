import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EnvironmentError, EnvironmentNotReadyError, aborted, bounded, normalize } from './errors.mjs';
import { defaultRunner } from './runner.mjs';
import { extractSafeTarGz } from './safe-tar.mjs';

export { EnvironmentError, EnvironmentNotReadyError, defaultRunner };
const LOCK_URL = new URL('../../resources/runtime-lock.json', import.meta.url);
const PHASES = new Set(['unprepared', 'checking', 'downloading', 'creating', 'installing', 'verifying', 'ready', 'failed', 'cancelled']);
const BUSY_PHASES = new Set(['checking', 'downloading', 'creating', 'installing', 'verifying']);
const HASH = /^[a-f0-9]{64}$/;
const PYTHON_VERSION = /^3\.([0-9]+)(?:\.([0-9]+))?$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,250}$/;
const OWNER = 'dsh-ios-webview-app-control.runtime.v1';
const PROBE_MS = 10000;
const MAX_LOCK_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const PROBE = 'import json,sys,struct;print(json.dumps({"implementation":sys.implementation.name,"version":"%d.%d.%d"%sys.version_info[:3],"bits":struct.calcsize("P")*8,"executable":sys.executable,"prefix":sys.prefix,"basePrefix":sys.base_prefix},separators=(",",":")))';
const HAS_VENV = 'import venv,ensurepip;print("venv-ok")';
const PACKAGE_CHECK = 'import importlib.metadata;print(importlib.metadata.version("pymobiledevice3"))';
const NATIVE_CHECK = 'import pymobiledevice3,cryptography,psutil,lzfse;from PIL import Image;from Crypto.Cipher import AES;print("native-imports-ok")';
const BOOTSTRAP = 'import sys;wheel=sys.argv.pop(1);sys.path.insert(0,wheel);from pip._internal.cli.main import main;raise SystemExit(main())';

const clone = value => JSON.parse(JSON.stringify(value));
const majorMinor = value => { const match = PYTHON_VERSION.exec(value || ''); return match ? `3.${Number(match[1])}` : null; };
const abiOf = value => { const version = majorMinor(value); return version ? 'cp' + version.replace('.', '') : null; };
const normalizedName = name => name.toLowerCase().replace(/[-_.]+/g, '-');
function inside(root, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function descriptor(asset, label, wheel = false) {
  if (!asset || typeof asset !== 'object' || !FILE_NAME.test(asset.filename || '') || asset.filename.includes('..') || (wheel && !asset.filename.endsWith('.whl'))) throw new EnvironmentError('runtime_lock_invalid', `${label} has an unsafe filename.`);
  let url;
  try { url = new URL(asset.url); } catch { throw new EnvironmentError('runtime_lock_invalid', `${label} URL is invalid.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !HASH.test(asset.sha256 || '') || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES) throw new EnvironmentError('runtime_lock_invalid', `${label} must have a locked HTTPS URL, SHA-256 and bounded size.`);
  return asset;
}
/** Strict schemaVersion 1 resource validation; an ABI is never selected without its entire wheel closure. */
export function validateRuntimeLock(input) {
  const lock = clone(input);
  if (!lock || lock.schemaVersion !== 1 || lock.platform !== 'win32' || lock.arch !== 'x64' || typeof lock.pymobiledevice3 !== 'string') throw new EnvironmentError('runtime_lock_invalid', 'runtime-lock.json must describe schemaVersion 1 win32 x64.');
  if (lock.fallback?.version !== '3.13.18' || lock.fallback.rootDir !== 'python' || lock.fallback.executable !== 'python/python.exe') throw new EnvironmentError('runtime_lock_invalid', 'Fallback must be the fixed PBS 3.13.18 private runtime.');
  descriptor(lock.fallback.archive, 'fallback.archive');
  if (!lock.fallback.archive.filename.endsWith('.tar.gz')) throw new EnvironmentError('runtime_lock_invalid', 'Fallback archive must be tar.gz.');
  if (!lock.environments || Array.isArray(lock.environments) || typeof lock.environments !== 'object') throw new EnvironmentError('runtime_lock_invalid', 'ABI environment locks are missing.');
  for (const [abi, environment] of Object.entries(lock.environments)) {
    if (!/^cp3[0-9]{1,2}$/.test(abi) || abi !== abiOf(environment?.python) || environment.python !== majorMinor(environment.python)) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} is invalid.`);
    descriptor(environment.pip, `${abi}.pip`, true);
    if (environment.pip.name !== 'pip' || typeof environment.pip.version !== 'string' || !Array.isArray(environment.wheels) || !environment.wheels.length || !Array.isArray(environment.requirements)) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} is incomplete.`);
    const byName = new Map();
    for (const wheel of environment.wheels) {
      descriptor(wheel, `${abi}.wheel`, true);
      if (typeof wheel.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(wheel.name) || typeof wheel.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.!+_-]*$/.test(wheel.version)) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} wheel metadata is invalid.`);
      const name = normalizedName(wheel.name);
      if (byName.has(name)) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} has duplicate package names.`);
      byName.set(name, wheel);
    }
    const required = new Set();
    for (const line of environment.requirements) {
      const match = typeof line === 'string' && line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*) --hash=sha256:([a-f0-9]{64})$/);
      if (!match) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} requirements must be exact single-wheel hash pins.`);
      const name = normalizedName(match[1]);
      const wheel = byName.get(name);
      if (!wheel || wheel.version !== match[2] || wheel.sha256 !== match[3] || required.has(name)) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} requirements do not match its wheel closure.`);
      required.add(name);
    }
    if (required.size !== byName.size || byName.get('pymobiledevice3')?.version !== lock.pymobiledevice3) throw new EnvironmentError('runtime_lock_invalid', `ABI ${abi} does not completely lock pymobiledevice3.`);
  }
  if (!lock.environments.cp313) throw new EnvironmentError('runtime_lock_invalid', 'The fallback cp313 ABI lock is missing.');
  return lock;
}
function parseProbe(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) { try { return JSON.parse(lines[index]); } catch {} }
  return null;
}
function safeEnvironment(source, home, baseDir, venvDir) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'SYSTEMDRIVE', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    const key = Object.keys(source).find(key => key.toLowerCase() === name.toLowerCase());
    if (key && source[key] !== undefined) env[name] = String(source[key]);
  }
  const windows = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  env.PATH = [venvDir ? path.join(venvDir, 'Scripts') : null, baseDir, path.win32.join(windows, 'System32'), windows].filter(Boolean).join(';');
  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = path.join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  env.TEMP = path.join(home, 'tmp');
  env.TMP = env.TEMP;
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PYTHONNOUSERSITE = '1';
  env.PIP_CACHE_DIR = path.join(home, 'pip-cache');
  env.PIP_CONFIG_FILE = 'NUL';
  env.PIP_NO_INPUT = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}
async function fileHash(file) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of createReadStream(file)) { hash.update(bytes); size += bytes.length; }
  return { sha256: hash.digest('hex'), size };
}
async function realFile(file) {
  try { const info = await lstat(file); return info.isFile() && !info.isSymbolicLink() ? info : null; } catch { return null; }
}

/** Node-only environment provisioning. It never opens a bridge, discovers devices or installs a host runtime. */
export class EnvironmentManager {
  constructor(config = {}, deps = {}) {
    this.config = config;
    this.deps = deps;
    this.platform = deps.platform || process.platform;
    this.arch = deps.arch || process.arch;
    this.env = deps.env || process.env;
    this.runner = deps.runner || defaultRunner;
    this.fetch = deps.fetch || globalThis.fetch;
    this.runtimeDir = path.resolve(deps.root || config.runtime?.directory || path.join(deps.home || os.homedir(), '.dsh-ios-webview-app-control', 'runtime'));
    this.timeoutMs = config.runtime?.timeoutMs ?? 900000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 10000 || this.timeoutMs > 3600000) throw new EnvironmentError('invalid_config', 'runtime.timeoutMs must be 10000..3600000.');
    this.offline = config.runtime?.offline === true;
    this.lock = null;
    this.lockDigest = null;
    this.lockOwner = null;
    this.listeners = new Set();
    this.controller = null;
    this.work = null;
    this.reads = new Set();
    this.disposed = false;
    this.generation = null;
    this.currentPython = null;
    this.privateLogs = [];
    this.snapshot = { phase: 'unprepared', busy: false, step: null, stage: null, progress: { completedBytes: 0, totalBytes: 0 }, bytes: { downloaded: 0, total: 0 }, python: { path: null, version: null, source: null, abi: null, provenance: null }, runtimeDir: this.runtimeDir, pymobiledevice3: null, error: null };
  }
  status() {
    const state=clone(this.snapshot);
    // Step and byte counters describe an in-flight preparation only. Once it
    // settles they read like a stalled download, so a public status drops them.
    if(BUSY_PHASES.has(state.phase)){
      state.step=state.step||state.stage||state.phase;
      state.progress=state.bytes.total>0?{completedBytes:state.bytes.downloaded,totalBytes:state.bytes.total}:null;
    }else{
      state.step='';
      state.progress=null;
    }
    if(!state.python?.path||!state.python?.version||!['host','private'].includes(state.python?.source))state.python=null;
    if(typeof state.pymobiledevice3!=='string')delete state.pymobiledevice3;
    return state;
  }
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('subscribe requires a function.');
    this.listeners.add(fn);
    try { fn(this.status()); } catch {}
    return () => this.listeners.delete(fn);
  }
  _state(patch) {
    const next = { ...this.snapshot, ...patch, runtimeDir: this.runtimeDir };
    if (!PHASES.has(next.phase)) throw new TypeError('Invalid runtime phase.');
    next.busy = BUSY_PHASES.has(next.phase);
    next.step = next.stage;
    next.python = { ...this.snapshot.python, ...patch.python };
    if (patch.bytes) next.bytes = { ...this.snapshot.bytes, ...patch.bytes };
    next.progress = { completedBytes: next.bytes.downloaded, totalBytes: next.bytes.total };
    if (next.error) next.error = { code: bounded(next.error.code, 80), message: bounded(next.error.message), stage: next.stage };
    this.snapshot = next;
    for (const listener of [...this.listeners]) { try { listener(this.status()); } catch {} }
  }
  async _resources() {
    if (this.lock) return this.lock;
    let value = this.deps.lock;
    if (!value) {
      let text;
      try { text = await readFile(LOCK_URL, 'utf8'); } catch { throw new EnvironmentError('runtime_lock_missing', 'resources/runtime-lock.json is required before environment preparation.'); }
      if (Buffer.byteLength(text) > MAX_LOCK_BYTES) throw new EnvironmentError('runtime_lock_invalid', 'Runtime lock exceeds its bounded size.');
      try { value = JSON.parse(text); } catch { throw new EnvironmentError('runtime_lock_invalid', 'Runtime lock is not valid JSON.'); }
    }
    this.lock = validateRuntimeLock(value);
    this.lockDigest = createHash('sha256').update(JSON.stringify(this.lock)).digest('hex');
    this.snapshot.pymobiledevice3 = this.lock.pymobiledevice3;
    return this.lock;
  }
  _supported() {
    if (this.platform !== 'win32' || this.arch !== 'x64') throw new EnvironmentError('unsupported_platform', 'EnvironmentManager supports only win32 x64.');
  }
  async _home(home) {
    await mkdir(path.join(home, 'tmp'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(home, 'pip-cache'), { recursive: true, mode: 0o700 });
  }
  async _run(executable, args, { signal, home = path.join(this.runtimeDir, '_setup'), generation, timeoutMs = this.timeoutMs, allowFailure = false } = {}) {
    aborted(signal);
    // -B also protects a host base whose stdlib happens not to have bytecode caches.
    const argv = args[0] === '-I' && !args.includes('-B') ? ['-I', '-B', ...args.slice(1)] : args;
    const outcome = await this.runner(executable, argv, { signal, timeoutMs, env: safeEnvironment(this.env, home, path.isAbsolute(executable) ? path.dirname(executable) : null, generation), cwd: path.resolve(generation || this.runtimeDir), onOutput: (stream, text) => { this.privateLogs.push({ stream, text: bounded(text, 1000) }); if (this.privateLogs.length > 40) this.privateLogs.shift(); } });
    aborted(signal);
    const result = { stdout: outcome?.stdout || '', stderr: outcome?.stderr || '', exitCode: outcome?.exitCode ?? 1 };
    if (!allowFailure && result.exitCode !== 0) throw new EnvironmentError('runtime_command_failed', `Runtime ${this.snapshot.stage || 'command'} failed (exit ${result.exitCode}).`, { stderr: bounded(result.stderr), exitCode: result.exitCode });
    return result;
  }
  async _acquireLock() {
    const file = path.join(this.runtimeDir, 'prepare.lock');
    const owner = { owner: OWNER, pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    try { await writeFile(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new EnvironmentError('environment_busy', 'Another process owns the runtime preparation lock. Live or unverified owners are never displaced.');
    }
    this.lockOwner = owner;
  }
  async _releaseLock() {
    if (!this.lockOwner) return;
    const owner = this.lockOwner;
    this.lockOwner = null;
    const file = path.join(this.runtimeDir, 'prepare.lock');
    try { const actual = JSON.parse(await readFile(file, 'utf8')); if (actual.token === owner.token && actual.pid === owner.pid) await rm(file); } catch {}
  }
  async _fingerprint(executable, version) {
    const info = await realFile(executable);
    return info ? { path: path.resolve(executable), size: info.size, mtimeMs: info.mtimeMs, version } : null;
  }
  async _probe(executable, provenance, lock, signal, venv = false) {
    if (!path.isAbsolute(executable) || /[/\\]WindowsApps(?:[/\\]|$)/i.test(executable) || !await realFile(executable)) return null;
    let result;
    try { result = await this._run(executable, ['-I', '-c', PROBE], { signal, timeoutMs: PROBE_MS, allowFailure: true }); } catch (error) { aborted(signal); return null; }
    const data = result.exitCode === 0 && parseProbe(result.stdout);
    const abi = abiOf(data?.version);
    if (!data || data.implementation !== 'cpython' || data.bits !== 64 || !abi || !lock.environments[abi] || typeof data.prefix !== 'string' || typeof data.basePrefix !== 'string') return null;
    if (venv && (path.resolve(data.prefix) === path.resolve(data.basePrefix) || !inside(this.runtimeDir, data.prefix))) return null;
    try { if (!venv && (await this._run(executable, ['-I', '-c', HAS_VENV], { signal, timeoutMs: PROBE_MS, allowFailure: true })).exitCode !== 0) return null; } catch { aborted(signal); return null; }
    return { executable: path.resolve(executable), version: data.version, abi, source: 'host', provenance, fingerprint: await this._fingerprint(executable, data.version), environment: lock.environments[abi] };
  }
  async *_candidates(signal) {
    const seen = new Set();
    const entry = (value, provenance) => {
      if (typeof value !== 'string' || !path.isAbsolute(value) || /[/\\]WindowsApps(?:[/\\]|$)/i.test(value)) return null;
      const key = path.resolve(value).toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return { executable: path.resolve(value), provenance };
    };
    for (const [value, provenance] of [[this.config.pythonPath, 'config'], [this.env.DSH_IOS_PYTHON, 'DSH_IOS_PYTHON'], [typeof this.env.DSH_PRIMARY_RUNTIME === 'string' && path.isAbsolute(this.env.DSH_PRIMARY_RUNTIME) ? path.join(this.env.DSH_PRIMARY_RUNTIME, 'dependencies', 'python', 'python.exe') : null, 'DSH_PRIMARY_RUNTIME']]) {
      const candidate = entry(value, provenance); if (candidate) yield candidate;
    }
    const sourcePath = String(this.env.PATH || this.env.Path || '').split(';').filter(value => value && path.isAbsolute(value) && !/[/\\]WindowsApps(?:[/\\]|$)/i.test(value));
    const windows = this.env.SystemRoot || this.env.WINDIR || 'C:\\Windows';
    const launchers = [path.join(windows, 'py.exe'), ...sourcePath.map(directory => path.join(directory, 'py.exe'))];
    for (const launcher of [...new Set(launchers)]) {
      if (!await realFile(launcher)) continue;
      try {
        const result = await this._run(launcher, ['-0p'], { signal, timeoutMs: PROBE_MS, allowFailure: true });
        for (const line of result.stdout.split(/\r?\n/)) {
          const match = line.match(/([A-Za-z]:[\\/].*?\.exe)\s*$/i);
          const candidate = match && entry(match[1], 'py-launcher'); if (candidate) yield candidate;
        }
      } catch { aborted(signal); }
    }
    const registry = path.win32.join(windows, 'System32', 'reg.exe');
    for (const key of ['HKCU\\Software\\Python\\PythonCore', 'HKLM\\Software\\Python\\PythonCore', 'HKLM\\Software\\WOW6432Node\\Python\\PythonCore']) {
      try {
        const result = await this._run(registry, ['query', key, '/s'], { signal, timeoutMs: PROBE_MS, allowFailure: true });
        let installPath = false;
        for (const line of result.stdout.split(/\r?\n/)) {
          if (/^HKEY_/i.test(line.trim())) { installPath = /\\InstallPath\s*$/i.test(line.trim()); continue; }
          if (!installPath) continue;
          const match = line.match(/^\s*(?:\(Default\)|ExecutablePath|默认)?\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i);
          if (!match || match[1].includes('%')) continue;
          const value = /\.exe$/i.test(match[1]) ? match[1] : path.join(match[1], 'python.exe');
          const candidate = entry(value, 'registry'); if (candidate) yield candidate;
        }
      } catch { aborted(signal); }
    }
    for (const directory of sourcePath) {
      for (const name of ['python.exe', 'python3.exe']) { const candidate = entry(path.join(directory, name), 'PATH'); if (candidate) yield candidate; }
    }
  }
  _assetPath(asset, archive = false) { return path.join(this.runtimeDir, 'cache', archive ? 'archives' : 'wheels', asset.sha256, asset.filename); }
  _bytes(amount) { this._state({ bytes: { downloaded: Math.min(this.snapshot.bytes.total, this.snapshot.bytes.downloaded + amount) } }); }
  async _fetchAsset(asset, archive, signal) {
    const file = this._assetPath(asset, archive);
    if (await realFile(file)) {
      const existing = await fileHash(file);
      if (existing.sha256 === asset.sha256 && existing.size === asset.size) { this._bytes(asset.size); return file; }
      await rm(file);
    }
    if (this.offline) throw new EnvironmentError('runtime_offline', 'Offline preparation requires every selected locked asset in the validated local cache.');
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    this._state({ phase: 'downloading', stage: archive ? 'python-archive' : 'wheels' });
    const original = new URL(asset.url);
    let url = original;
    let response;
    const redirectHosts = new Set([original.hostname]);
    if (original.hostname === 'github.com') for (const name of ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']) redirectHosts.add(name);
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await this.fetch(url.href, { signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      const next = location && new URL(location, url);
      await response.body?.cancel?.();
      if (redirects === 5 || !next || next.protocol !== 'https:' || next.username || next.password || !redirectHosts.has(next.hostname)) throw new EnvironmentError('runtime_download_redirect', 'Locked download redirected outside its allowed HTTPS asset hosts.');
      url = next;
    }
    if (!response?.ok || !response.body?.getReader) throw new EnvironmentError('runtime_download_failed', `Locked asset download returned HTTP ${response?.status ?? 'unknown'}.`);
    const advertised = response.headers.get('content-length');
    if (advertised && Number(advertised) !== asset.size) { await response.body.cancel(); throw new EnvironmentError('runtime_integrity', 'Locked asset Content-Length does not match.'); }
    const temporary = file + '.part-' + randomUUID();
    const handle = await open(temporary, 'wx', 0o600);
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for (;;) {
        aborted(signal);
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        bytes += chunk.length;
        if (bytes > asset.size) throw new EnvironmentError('runtime_integrity', 'Locked asset exceeds its declared size.');
        hash.update(chunk);
        await handle.writeFile(chunk);
        this._bytes(chunk.length);
      }
      if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new EnvironmentError('runtime_integrity', 'Locked asset size or SHA-256 differs from runtime-lock.json.');
      await handle.sync();
      await handle.close();
      await rename(temporary, file);
      return file;
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw normalize(error, signal, 'runtime_download_failed');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async _base(lock, signal, forcePrivate) {
    if (!forcePrivate) for await (const candidate of this._candidates(signal)) {
      aborted(signal);
      const base = await this._probe(candidate.executable, candidate.provenance, lock, signal);
      if (base) return base;
    }
    const archive = lock.fallback.archive;
    this._state({ bytes: { downloaded: 0, total: archive.size + lock.environments.cp313.pip.size + lock.environments.cp313.wheels.reduce((sum, wheel) => sum + wheel.size, 0) }, python: { source: 'private', version: lock.fallback.version, abi: 'cp313', provenance: 'PBS' } });
    const file = await this._fetchAsset(archive, true, signal);
    const baseDirectory = path.join(this.runtimeDir, 'bases', `b-${randomUUID()}`);
    await mkdir(baseDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(baseDirectory, 'owner.json'), JSON.stringify({ owner: OWNER, archive: archive.sha256 }), { flag: 'wx', mode: 0o600 });
    this._state({ phase: 'creating', stage: 'extracting-python' });
    await extractSafeTarGz(await readFile(file), baseDirectory, { signal });
    const executable = path.join(baseDirectory, ...lock.fallback.executable.split('/'));
    const probe = await this._probe(executable, 'PBS', lock, signal);
    if (!probe || probe.version !== lock.fallback.version) throw new EnvironmentError('runtime_verify_failed', 'The PBS runtime did not verify as locked CPython 3.13.18 x64.');
    return { ...probe, source: 'private', baseDirectory, archiveSha256: archive.sha256 };
  }
  async _rawPointer() {
    try {
      const file = await readFile(path.join(this.runtimeDir, 'ready.json'), 'utf8');
      if (file.length > 8192) return null;
      const pointer = JSON.parse(file);
      if (pointer?.owner !== OWNER || pointer.schemaVersion !== 1 || !inside(path.join(this.runtimeDir, 'generations'), pointer.generation) || pointer.interpreter !== path.join(pointer.generation, 'Scripts', 'python.exe') || !await realFile(pointer.interpreter)) return null;
      return pointer;
    } catch { return null; }
  }
  async _ready(lock, signal) {
    const pointer = await this._rawPointer();
    if (!pointer || pointer.lockDigest !== this.lockDigest || !lock.environments[pointer.python?.abi]) return null;
    if (!pointer.base?.fingerprint || !path.isAbsolute(pointer.base.executable || '')) return null;
    const fingerprint = await this._fingerprint(pointer.base.executable, pointer.python.version);
    if (JSON.stringify(fingerprint) !== JSON.stringify(pointer.base.fingerprint)) return null;
    if (pointer.base.source === 'private' && (!inside(path.join(this.runtimeDir, 'bases'), pointer.base.executable) || pointer.base.archiveSha256 !== lock.fallback.archive.sha256)) return null;
    const probe = await this._probe(pointer.interpreter, 'ready', lock, signal, true);
    if (!probe || probe.abi !== pointer.python.abi || probe.version !== pointer.python.version) return null;
    try {
      const result = await this._run(pointer.interpreter, ['-I', '-c', PACKAGE_CHECK], { signal, timeoutMs: PROBE_MS, home: path.join(pointer.generation, '_home'), generation: pointer.generation, allowFailure: true });
      if (result.exitCode !== 0 || result.stdout.trim() !== lock.pymobiledevice3) return null;
    } catch { aborted(signal); return null; }
    return pointer;
  }
  async _wheelhouse(assets, generation, signal) {
    const wheelhouse = path.join(generation, 'wheelhouse');
    await mkdir(wheelhouse, { mode: 0o700 });
    const files = new Map();
    for (const asset of assets) {
      aborted(signal);
      const cached = await this._fetchAsset(asset, false, signal);
      const target = path.join(wheelhouse, asset.filename);
      if (!files.has(asset.filename)) {
        try { await link(cached, target); } catch { await copyFile(cached, target); }
        files.set(asset.filename, target);
      }
    }
    return { wheelhouse, files };
  }
  async _selfcheck(interpreter, generation, lock, signal) {
    const options = { signal, generation, home: path.join(generation, '_home') };
    const probe = await this._probe(interpreter, 'new-venv', lock, signal, true);
    if (!probe) throw new EnvironmentError('runtime_verify_failed', 'New Python is not an isolated private venv.');
    const cfg = await readFile(path.join(generation, 'pyvenv.cfg'), 'utf8');
    if (!/^include-system-site-packages\s*=\s*false\s*$/mi.test(cfg)) throw new EnvironmentError('runtime_verify_failed', 'Private venv must not include system site packages.');
    const version = await this._run(interpreter, ['-I', '-c', PACKAGE_CHECK], options);
    if (version.stdout.trim() !== lock.pymobiledevice3) throw new EnvironmentError('runtime_verify_failed', 'Installed pymobiledevice3 does not match the lock.');
    await this._run(interpreter, ['-I', '-m', 'pip', '--isolated', '--require-virtualenv', 'check'], options);
    await this._run(interpreter, ['-I', '-c', NATIVE_CHECK], options);
    await this._run(interpreter, ['-I', '-m', 'pymobiledevice3', '--help'], options);
    return probe;
  }
  async _publish(pointer, signal) {
    const target = path.join(this.runtimeDir, 'ready.json');
    const temporary = target + '.tmp-' + randomUUID();
    aborted(signal);
    await writeFile(temporary, JSON.stringify(pointer), { flag: 'wx', mode: 0o600 });
    try { aborted(signal); await rename(temporary, target); } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async _prepare(signal, forcePrivate) {
    this._supported();
    aborted(signal);
    this._state({ phase: 'checking', stage: 'runtime-lock', error: null, bytes: { downloaded: 0, total: 0 } });
    const lock = await this._resources();
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    await this._acquireLock();
    try {
      await this._home(path.join(this.runtimeDir, '_setup'));
      this._state({ phase: 'verifying', stage: 'ready-pointer' });
      const prior = await this._ready(lock, signal);
      if (prior && (!forcePrivate || prior.base.source === 'private')) {
        this.currentPython = prior.interpreter;
        this._state({ phase: 'ready', stage: 'reused', python: prior.python, error: null });
        return this.status();
      }
      this._state({ phase: 'checking', stage: 'host-python' });
      const base = await this._base(lock, signal, forcePrivate);
      const environment = base.environment;
      if (base.source === 'host') this._state({ bytes: { downloaded: 0, total: environment.pip.size + environment.wheels.reduce((sum, wheel) => sum + wheel.size, 0) } });
      const generation = path.join(this.runtimeDir, 'generations', `g-${Date.now()}-${randomUUID()}`);
      this.generation = generation;
      await mkdir(generation, { recursive: true, mode: 0o700 });
      await writeFile(path.join(generation, 'owner.json'), JSON.stringify({ owner: OWNER, pid: process.pid, baseDirectory: base.baseDirectory || null }), { flag: 'wx', mode: 0o600 });
      await this._home(path.join(generation, '_home'));
      const python = { path: path.join(generation, 'Scripts', 'python.exe'), source: base.source, provenance: base.provenance, version: base.version, abi: base.abi };
      this._state({ phase: 'downloading', stage: 'wheels', python });
      const assets = [environment.pip, ...environment.wheels];
      const { wheelhouse, files } = await this._wheelhouse(assets, generation, signal);
      this._state({ phase: 'creating', stage: 'venv' });
      const options = { signal, generation, home: path.join(generation, '_home') };
      await this._run(base.executable, ['-I', '-m', 'venv', '--without-pip', generation], options);
      if (!await realFile(python.path)) throw new EnvironmentError('runtime_create_failed', 'Python did not create the private venv interpreter.');
      const venv = await this._probe(python.path, 'new-venv', lock, signal, true);
      if (!venv || venv.abi !== base.abi) throw new EnvironmentError('runtime_verify_failed', 'Created interpreter is not the expected private venv.');
      const pipWheel = files.get(environment.pip.filename);
      this._state({ phase: 'installing', stage: 'pip-bootstrap' });
      await this._run(python.path, ['-I', '-c', BOOTSTRAP, pipWheel, '--isolated', '--require-virtualenv', 'install', '--no-deps', '--no-index', '--no-user', '--no-compile', '--disable-pip-version-check', '--only-binary', ':all:', pipWheel], options);
      const requirements = path.join(generation, 'requirements.txt');
      await writeFile(requirements, environment.requirements.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      this._state({ phase: 'installing', stage: 'packages' });
      await this._run(python.path, ['-I', '-m', 'pip', '--isolated', '--require-virtualenv', 'install', '--no-index', '--find-links', wheelhouse, '--require-hashes', '--only-binary', ':all:', '--no-user', '--no-compile', '--disable-pip-version-check', '--no-input', '--no-cache-dir', '-r', requirements], options);
      this._state({ phase: 'verifying', stage: 'self-check' });
      await this._selfcheck(python.path, generation, lock, signal);
      const pointer = { owner: OWNER, schemaVersion: 1, generation, interpreter: python.path, python, base: { executable: base.executable, source: base.source, fingerprint: base.fingerprint, baseDirectory: base.baseDirectory || null, archiveSha256: base.archiveSha256 || null }, lockDigest: this.lockDigest, preparedAt: new Date().toISOString() };
      await this._publish(pointer, signal);
      this.currentPython = python.path;
      this._state({ phase: 'ready', stage: 'published', python, error: null });
      return this.status();
    } finally { this.generation = null; await this._releaseLock(); }
  }
  prepare({ signal, forcePrivate = false } = {}) {
    if (this.disposed) return Promise.reject(new EnvironmentError('environment_disposed', 'EnvironmentManager has been disposed.'));
    if (this.work) return this.work;
    const controller = new AbortController();
    this.controller = controller;
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(new EnvironmentError('runtime_timeout', 'Runtime preparation exceeded its deadline.')), this.timeoutMs);
    this.work = this._prepare(combined, forcePrivate).catch(error => {
      const failure = normalize(error, combined);
      this._state({ phase: failure.code === 'cancelled' ? 'cancelled' : 'failed', error: failure });
      throw failure;
    }).finally(() => { clearTimeout(timeout); this.controller = null; this.work = null; });
    return this.work;
  }
  cancel() { this.controller?.abort(new EnvironmentError('cancelled', 'Runtime preparation was cancelled.')); }
  async requirePython({ signal } = {}) {
    if (this.disposed) throw new EnvironmentNotReadyError('EnvironmentManager has been disposed.');
    this._supported();
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    aborted(combined);
    const work = (async () => {
      const lock = await this._resources();
      const pointer = await this._ready(lock, combined);
      aborted(combined);
      if (!pointer) throw new EnvironmentNotReadyError('Runtime is not ready; prepare it explicitly before device operations.');
      this.currentPython = pointer.interpreter;
      return pointer.interpreter;
    })();
    const record = { controller, work };
    this.reads.add(record);
    try { return await work; } catch (error) { aborted(combined); if (error instanceof EnvironmentNotReadyError) throw error; throw new EnvironmentNotReadyError(bounded(error.message)); } finally { this.reads.delete(record); }
  }
  async cleanup({ signal } = {}) {
    if (this.disposed) throw new EnvironmentError('environment_disposed', 'EnvironmentManager has been disposed.');
    if (this.work) throw new EnvironmentError('environment_busy', 'Cannot clean runtime files while preparation is active.');
    aborted(signal);
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    await this._acquireLock();
    try {
      const pointer = await this._rawPointer();
      const generations = path.join(this.runtimeDir, 'generations');
      const retainedBases = new Set(pointer?.base?.baseDirectory ? [pointer.base.baseDirectory] : []);
      for (const entry of await readdir(generations, { withFileTypes: true }).catch(() => [])) {
        aborted(signal);
        const directory = path.join(generations, entry.name);
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^g-[0-9]+-[a-f0-9-]+$/.test(entry.name)) continue;
        let ownership;
        try { ownership = JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')); } catch { continue; }
        if (ownership.owner !== OWNER) continue;
        if (directory === pointer?.generation) { if (ownership.baseDirectory) retainedBases.add(ownership.baseDirectory); continue; }
        await rm(directory, { recursive: true });
      }
      const bases = path.join(this.runtimeDir, 'bases');
      for (const entry of await readdir(bases, { withFileTypes: true }).catch(() => [])) {
        aborted(signal);
        const directory = path.join(bases, entry.name);
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^b-[a-f0-9-]+$/.test(entry.name) || retainedBases.has(directory) || (pointer?.base?.executable && inside(directory, pointer.base.executable))) continue;
        try { if (JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8')).owner !== OWNER) continue; } catch { continue; }
        await rm(directory, { recursive: true });
      }
      for (const kind of ['wheels', 'archives']) {
        const cache = path.join(this.runtimeDir, 'cache', kind);
        for (const entry of await readdir(cache, { withFileTypes: true }).catch(() => [])) {
          aborted(signal);
          if (entry.isDirectory() && !entry.isSymbolicLink() && HASH.test(entry.name)) await rm(path.join(cache, entry.name), { recursive: true });
        }
      }
      return this.status();
    } finally { await this._releaseLock(); }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    for (const record of this.reads) record.controller.abort();
    await Promise.allSettled([...(this.work ? [this.work] : []), ...[...this.reads].map(record => record.work)]);
    this.listeners.clear();
  }
}
export default EnvironmentManager;
