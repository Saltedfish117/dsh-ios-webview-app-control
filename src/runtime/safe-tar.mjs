import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentError, aborted } from './errors.mjs';

const BLOCK = 512;
const MAX_ENTRIES = 100_000;
const MAX_EXPANDED = 512 * 1024 * 1024;
const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;

function reject(message) {
  throw new EnvironmentError('runtime_archive_invalid', message);
}

function string(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString('utf8');
}

function number(header, start, length) {
  const raw = header.subarray(start, start + length);
  if (raw[0] & 0x80) reject('Tar base-256 sizes are not supported.');
  const text = string(header, start, length).trim();
  if (text && !/^[0-7]+$/.test(text)) reject('Tar contains an invalid numeric field.');
  const result = text ? parseInt(text, 8) : 0;
  if (!Number.isSafeInteger(result)) reject('Tar numeric field exceeds the safe bound.');
  return result;
}

function safeName(value) {
  if (!value || value.length > 1024 || /[\\\x00-\x1f:\x7f]/.test(value) || value.startsWith('/')) reject('Tar contains an absolute, ADS, control-character or unsafe path.');
  const name = value.replace(/\/+$/, '');
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part))) reject('Tar contains a traversal or reserved Windows path.');
  return parts.join('/');
}

function pax(bytes) {
  const output = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    if (space < 0) reject('Tar contains malformed PAX metadata.');
    const lengthText = bytes.toString('ascii', offset, space);
    if (!/^[0-9]+$/.test(lengthText)) reject('Tar contains malformed PAX record lengths.');
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || offset + length > bytes.length || bytes[offset + length - 1] !== 10) reject('Tar contains truncated PAX metadata.');
    const text = bytes.toString('utf8', space + 1, offset + length - 1);
    const equals = text.indexOf('=');
    if (equals < 1) reject('Tar contains malformed PAX metadata.');
    const key = text.slice(0, equals);
    if (/linkpath|sparse/i.test(key)) reject('Tar PAX links and sparse files are forbidden.');
    output[key] = text.slice(equals + 1);
    offset += length;
  }
  return output;
}

async function ensureDirectory(root, relative) {
  let current = root;
  for (const part of relative ? relative.split('/') : []) {
    current = path.join(current, part);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) reject('Tar parent path is not a private real directory.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

/** Bounded tar.gz extraction. No symlinks, hardlinks, devices, sparse files or writes outside destination. */
export async function extractSafeTarGz(archive, destination, { signal, maxExpanded = MAX_EXPANDED, maxEntries = MAX_ENTRIES } = {}) {
  aborted(signal);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  if ((await lstat(destination)).isSymbolicLink()) reject('Archive destination must not be a symlink.');
  const gunzip = createGunzip();
  const source = Readable.from(archive);
  const input = source.pipe(gunzip);
  const iterator = input[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  let expanded = 0;
  let done = false;
  const stop = () => { source.destroy(); input.destroy(new EnvironmentError('cancelled', 'Runtime extraction was cancelled.')); };
  signal?.addEventListener('abort', stop, { once: true });
  const take = async length => {
    while (buffer.length < length && !done) {
      aborted(signal);
      const next = await iterator.next();
      done = next.done === true;
      if (!done) {
        expanded += next.value.length;
        if (expanded > maxExpanded) reject('Archive expands beyond the allowed size.');
        buffer = Buffer.concat([buffer, next.value]);
      }
    }
    if (buffer.length < length) reject('Tar contains a truncated record.');
    const value = buffer.subarray(0, length);
    buffer = buffer.subarray(length);
    return value;
  };
  const names = new Set();
  let entries = 0;
  let globalPax = {};
  let localPax = {};
  let longName = null;
  try {
    for (;;) {
      const header = await take(BLOCK);
      if (header.every(byte => byte === 0)) {
        const second = await take(BLOCK);
        if (!second.every(byte => byte === 0)) reject('Tar end-of-archive marker is invalid.');
        while (!done) {
          const next = await iterator.next();
          done = next.done === true;
          if (!done) {
            expanded += next.value.length;
            if (expanded > maxExpanded || next.value.some(byte => byte !== 0)) reject('Archive has excessive or nonzero trailing data.');
          }
        }
        if (buffer.some(byte => byte !== 0)) reject('Archive has nonzero trailing data.');
        break;
      }
      entries++;
      if (entries > maxEntries) reject('Archive contains too many entries.');
      const expectedChecksum = number(header, 148, 8);
      let actualChecksum = 0;
      for (let index = 0; index < BLOCK; index++) actualChecksum += index >= 148 && index < 156 ? 32 : header[index];
      if (expectedChecksum !== actualChecksum) reject('Tar header checksum is invalid.');
      const type = String.fromCharCode(header[156] || 48);
      let size = number(header, 124, 12);
      const metadata = { ...globalPax, ...localPax };
      if (metadata.size !== undefined) {
        if (!/^[0-9]+$/.test(metadata.size)) reject('PAX size is invalid.');
        size = Number(metadata.size);
      }
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY || size > maxExpanded) reject('Archive entry exceeds the allowed size.');
      if (['x', 'g', 'L'].includes(type)) {
        if (size > MAX_METADATA) reject('Tar metadata exceeds its bound.');
        const data = await take(Math.ceil(size / BLOCK) * BLOCK);
        if (type === 'L') longName = data.subarray(0, size).toString('utf8').replace(/\0.*$/s, '');
        else if (type === 'g') globalPax = { ...globalPax, ...pax(data.subarray(0, size)) };
        else localPax = pax(data.subarray(0, size));
        continue;
      }
      if (type !== '0' && type !== '5') reject('Archive links and special file types are forbidden.');
      const prefix = string(header, 345, 155);
      const name = safeName(metadata.path || longName || [prefix, string(header, 0, 100)].filter(Boolean).join('/'));
      localPax = {};
      longName = null;
      const canonical = name.toLowerCase();
      if (names.has(canonical)) reject('Archive contains duplicate or case-colliding paths.');
      names.add(canonical);
      const target = path.resolve(destination, ...name.split('/'));
      const relative = path.relative(destination, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) reject('Archive path escapes its private directory.');
      if (type === '5') {
        if (size !== 0) reject('Tar directory has nonzero content.');
        await ensureDirectory(destination, name);
      } else {
        await ensureDirectory(destination, name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');
        const data = await take(Math.ceil(size / BLOCK) * BLOCK);
        await writeFile(target, data.subarray(0, size), { flag: 'wx', mode: 0o600 });
      }
    }
    return { entries, expandedBytes: expanded };
  } catch (error) {
    if (error instanceof EnvironmentError) throw error;
    throw new EnvironmentError('runtime_archive_invalid', `Cannot extract locked tar.gz: ${error?.message || error}`);
  } finally {
    signal?.removeEventListener('abort', stop);
    source.destroy();
    input.destroy();
  }
}
