import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { extractSafeTarGz } from '../src/runtime/safe-tar.mjs';

function record(name, bytes = Buffer.alloc(0), type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 0]]) header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
  header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
const archive = records => gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]));
async function destination(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ios-runtime-tar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function paxLine(key, value) {
  const content = `${key}=${value}\n`;
  let length = Buffer.byteLength(content) + 3;
  while (length !== Buffer.byteLength(String(length) + ' ' + content)) length = Buffer.byteLength(String(length) + ' ' + content);
  return Buffer.from(String(length) + ' ' + content);
}

test('safe tar handles PBS-style trailing directory names and bounded PAX paths', async t => {
  const root = await destination(t);
  const output = await extractSafeTarGz(archive([record('python/', undefined, '5'), record('metadata', paxLine('path', 'python/python.exe'), 'x'), record('placeholder', Buffer.from('locked-python'))]), root);
  assert.equal(await readFile(path.join(root, 'python', 'python.exe'), 'utf8'), 'locked-python');
  assert.equal(output.entries, 3);
});
for (const name of ['../escape', '/absolute', 'C:/absolute', 'python/file:stream', 'python/CON', 'python/a\\b', 'python/trailing.', 'python/../escape']) {
  test('safe tar rejects traversal/ADS/reserved path: ' + name, async t => {
    await assert.rejects(extractSafeTarGz(archive([record(name, Buffer.from('bad'))]), await destination(t)), { code: 'runtime_archive_invalid' });
  });
}
for (const type of ['1', '2', '3', '4', '6', '7', 'K']) {
  test('safe tar rejects links and special file type ' + type, async t => {
    await assert.rejects(extractSafeTarGz(archive([record('python/bad', undefined, type)]), await destination(t)), { code: 'runtime_archive_invalid' });
  });
}
test('safe tar rejects checksum errors, duplicate case paths, oversized expansion and excessive entries', async t => {
  const corrupt = record('python/python.exe', Buffer.from('bad')); corrupt[20] ^= 1;
  await assert.rejects(extractSafeTarGz(archive([corrupt]), await destination(t)), { code: 'runtime_archive_invalid' });
  await assert.rejects(extractSafeTarGz(archive([record('python/a', Buffer.from('a')), record('python/A', Buffer.from('b'))]), await destination(t)), { code: 'runtime_archive_invalid' });
  await assert.rejects(extractSafeTarGz(archive([record('python/big', Buffer.alloc(10000))]), await destination(t), { maxExpanded: 1000 }), { code: 'runtime_archive_invalid' });
  await assert.rejects(extractSafeTarGz(archive([record('python/a', Buffer.from('a')), record('python/b', Buffer.from('b'))]), await destination(t), { maxEntries: 1 }), { code: 'runtime_archive_invalid' });
});
test('safe tar refuses PAX link metadata and premature cancellation', async t => {
  await assert.rejects(extractSafeTarGz(archive([record('metadata', paxLine('linkpath', 'elsewhere'), 'x'), record('python/a', Buffer.from('bad'))]), await destination(t)), { code: 'runtime_archive_invalid' });
  const ac = new AbortController(); ac.abort();
  await assert.rejects(extractSafeTarGz(archive([]), await destination(t), { signal: ac.signal }), { code: 'cancelled' });
});
