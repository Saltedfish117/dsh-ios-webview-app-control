import test from 'node:test';
import assert from 'node:assert/strict';
import { IosControl } from '../src/core/service.mjs';
import { IosError, assertLosslessJson, fetchJson } from '../src/core/protocol.mjs';
import { CHECK_STATUSES, preflightReport, recoveryMessage } from '../src/core/preflight.mjs';

const exec = () => ({ owner: 'preflight-test-session', signal: new AbortController().signal });
const connect = { platform: 'ios', appType: 'hybrid', endpoint: 'http://127.0.0.1:9333', udid: 'operator-device', verifiedExistingUdid: 'operator-device' };
const item = (report, id) => report.checks.find(check => check.id === id);
const next = (report, id) => report.nextActions.find(action => action.id === id);
const noIo = () => { throw Error('No device, bridge, preparation or CDP I/O in local preflight'); };
function service(t, environment, extra = {}) {
  const s = new IosControl({}, { environment, runPython: noIo, fetchJson: noIo, targets: noIo, connectCdp: noIo, ...extra });
  t.after(() => s.dispose());
  return s;
}

test('local discovery preflight verifies runtime only and leaves phone state unknown', async t => {
  let verifies = 0;
  const environment = { status: () => ({ busy: false }), prepare: noIo, requirePython: async ({ signal }) => { verifies++; assert.ok(signal instanceof AbortSignal); return 'private-python'; } };
  const s = service(t, environment);
  const r = await s.execute('preflight', { workflow: 'device-discovery' }, exec());
  assert.equal(verifies, 1);
  assert.equal(r.preflight.deviceAccessPerformed, false);
  assert.equal(r.preflight.authorizationGranted, false);
  assert.equal(item(r.preflight, 'software_runtime').status, 'passed');
  for (const id of ['usb_trust', 'web_inspector', 'developer_mode', 'app_inspectability', 'device_binding', 'app_identity']) assert.equal(item(r.preflight, id).status, 'unknown');
  assert.equal(item(r.preflight, 'bridge_endpoint').status, 'not_checked');
  assert.equal(next(r.preflight, 'discover_devices').requiresApproval, true);
  assert.match(next(r.preflight, 'enable_web_inspector').message, /设置 → App → Safari/);
  assert.match(next(r.preflight, 'enable_web_inspector').message, /设置 → Safari/);
  assert.match(next(r.preflight, 'developer_mode_if_needed').message, /不一律要求/);
  assert.equal(s.connections.size, 0); assert.equal(s.leased.size, 0);
  assertLosslessJson(r);
});

test('existing bridge preflight never even checks Python, status, or transport', async t => {
  const s = service(t, { status: noIo, requirePython: noIo, prepare: noIo });
  const r = await s.execute('preflight', { workflow: 'existing-bridge' }, exec());
  assert.equal(item(r.preflight, 'software_runtime').status, 'not_applicable');
  assert.equal(item(r.preflight, 'bridge_endpoint').status, 'not_checked');
  assert.equal(next(r.preflight, 'inspect_environment'), undefined);
  assert.equal(next(r.preflight, 'prepare_environment'), undefined);
  assert.equal(next(r.preflight, 'connect_existing_bridge').requiresApproval, true);
  assert.equal(r.preflight.deviceAccessPerformed, false);
});

test('failed runtime is a failed observation, never arbitrary error details or an implicit install', async t => {
  const s = service(t, { status: () => ({ busy: false }), prepare: noIo, requirePython: async () => { throw Object.assign(new Error('SECRET-env-stderr'), { code: 'environment_not_ready', details: { token: 'SECRET-token' } }); } });
  const r = await s.execute('preflight', { workflow: 'device-discovery' }, exec());
  assert.equal(item(r.preflight, 'software_runtime').status, 'failed');
  assert.equal(item(r.preflight, 'software_runtime').evidence, 'environment_not_ready');
  assert.equal(next(r.preflight, 'inspect_environment').tool, 'ios_environment');
  assert.equal(next(r.preflight, 'inspect_environment').requiresApproval, false);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});

test('unsupported local runtime explains platform limit without an impossible preparation loop', async t => {
  const s = service(t, { status: () => ({ busy: false }), requirePython: async () => { throw new IosError('unsupported_platform', 'not supported'); }, prepare: noIo });
  const r = await s.execute('preflight', { workflow: 'device-discovery' }, exec());
  assert.equal(item(r.preflight, 'software_runtime').status, 'failed');
  assert.equal(item(r.preflight, 'software_runtime').evidence, 'unsupported_platform');
  assert.match(item(r.preflight, 'software_runtime').message, /Windows x64/);
  assert.equal(next(r.preflight, 'prepare_environment'), undefined);
  assert.match(next(r.preflight, 'unsupported_runtime').message, /不要反复 prepare/);
});

test('busy or unmanaged local runtime is unknown, not a false ready signal', async t => {
  const busy = service(t, { status: () => ({ busy: true }), requirePython: noIo, prepare: noIo });
  assert.equal(item((await busy.execute('preflight', { workflow: 'device-discovery' }, exec())).preflight, 'software_runtime').status, 'unknown');
  const unmanaged = service(t, undefined);
  assert.equal(item((await unmanaged.execute('preflight', { workflow: 'device-discovery' }, exec())).preflight, 'software_runtime').status, 'unknown');
});

test('local preflight validates workflow, owner, lifecycle and cancellation', async t => {
  const s = service(t, { status: noIo, requirePython: noIo });
  for (const workflow of [undefined, '', 'android', 'automatic', 'native']) await assert.rejects(s.execute('preflight', { workflow }, exec()), { code: 'invalid_arguments' });
  await assert.rejects(s.execute('preflight', { workflow: 'existing-bridge' }, {}), { code: 'owner_required' });
  const ac = new AbortController(); ac.abort();
  await assert.rejects(s.execute('preflight', { workflow: 'existing-bridge' }, { owner: 'test', signal: ac.signal }));
  await s.dispose();
  await assert.rejects(s.execute('preflight', { workflow: 'existing-bridge' }, exec()), { code: 'service_disposed' });
});

test('abort during local runtime check rejects, never returns failed or ready', async t => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const s = service(t, { status: () => ({ busy: false }), requirePython: ({ signal }) => new Promise((resolve, reject) => { started(); signal.addEventListener('abort', () => reject(new IosError('cancelled', 'stopped')), { once: true }); }) });
  const ac = new AbortController();
  const pending = s.execute('preflight', { workflow: 'device-discovery' }, { owner: 'test', signal: ac.signal });
  await began; ac.abort(); await assert.rejects(pending, { code: 'cancelled' });
});

for (const count of [0, 1]) test('device list count ' + count + ' has evidence but does not prove Trust or Web Inspector', async t => {
  const s = service(t, { requirePython: async () => 'private' }, { runPython: async () => JSON.stringify(count ? [{ Identifier: 'test-device' }] : []) });
  const r = await s.execute('devices', {}, exec());
  assert.equal(r.devices.length, count);
  assert.equal(item(r.preflight, 'software_runtime').status, 'passed');
  assert.equal(item(r.preflight, 'device_discovery').status, count ? 'passed' : 'failed');
  assert.equal(item(r.preflight, 'usb_trust').status, 'unknown');
  assert.equal(item(r.preflight, 'web_inspector').status, 'unknown');
  assert.equal(r.preflight.deviceAccessPerformed, true);
  assert.equal(r.preflight.authorizationGranted, false);
  if (!count) assert.equal(next(r.preflight, 'retry_device_discovery').requiresApproval, true);
});

for (const pages of [[], [{ id: 'context', type: 'node' }], [{ id: 'page', type: 'page' }]]) test('bridge metadata ' + JSON.stringify(pages) + ' never proves phone switch/app identity', async t => {
  const s = service(t, { status: noIo, requirePython: noIo }, { fetchJson: async () => ({ 'User-Agent': 'pymobiledevice3' }), targets: async () => pages });
  const c = await s.execute('connect', connect, exec());
  const r = await s.execute('targets', { connectionId: c.connectionId }, exec());
  for (const report of [c.preflight, r.preflight]) {
    assert.equal(item(report, 'software_runtime').status, 'not_applicable');
    assert.equal(item(report, 'bridge_endpoint').status, 'passed');
    assert.equal(item(report, 'page_targets').status, pages.some(page => page.type === 'page') ? 'passed' : 'failed');
    assert.equal(item(report, 'web_inspector').status, 'unknown');
    assert.equal(item(report, 'device_binding').status, 'unknown');
    assert.equal(item(report, 'app_identity').status, 'unknown');
    assert.equal(report.authorizationGranted, false);
    assertLosslessJson(report);
    if (!pages.some(page => page.type === 'page')) assert.equal(next(report, 'retry_target_listing').requiresApproval, true);
  }
  assert.equal(c.targetCount, pages.length);
  assert.equal(s.connections.get(c.connectionId).targetBinding, undefined);
});

test('reports are isolated bounded JSON; untrusted metadata cannot become next actions', () => {
  for (const stage of ['local', 'devices', 'connect', 'targets']) for (const workflow of ['device-discovery', 'existing-bridge']) {
    const report = preflightReport({ stage, workflow, runtime: 'passed', runtimeCode: 'SECRET-stderr' });
    assertLosslessJson(report);
    assert.ok(JSON.stringify(report).length < 9000);
    assert.doesNotMatch(JSON.stringify(report), /SECRET/);
    assert.ok(report.checks.every(check => CHECK_STATUSES.includes(check.status)));
    assert.equal(new Set(report.checks.map(check => check.id)).size, report.checks.length);
  }
  const a = preflightReport(); a.nextActions[0].message = 'tampered'; a.checks[0].status = 'passed';
  assert.doesNotMatch(JSON.stringify(preflightReport()), /tampered/);
  assert.equal(item(preflightReport(), 'software_runtime').status, 'unknown');
});

test('malformed target entries fail before creating connection state', async t => {
  for (const pages of [[null], [1], ['SECRET-entry'], [[]], [{ type: {} }], [{ url: ['SECRET'] }], {}]) {
    const s = service(t, undefined, { fetchJson: async () => ({ 'User-Agent': 'pymobiledevice3' }), targets: async () => pages });
    await assert.rejects(s.execute('connect', connect, exec()), error => {
      assert.equal(error.code, 'invalid_bridge');
      assert.doesNotMatch(error.message, /SECRET|Cannot read/);
      return true;
    });
    assert.equal(s.connections.size, 0);
  }
});

test('malformed discovery output is a safe fixed error, never a snippet of device output', async t => {
  const s = service(t, { requirePython: async () => 'private' }, { runPython: async () => 'SECRET-malformed-device-output' });
  await assert.rejects(s.execute('devices', {}, exec()), error => {
    assert.equal(error.code, 'invalid_device_list');
    assert.doesNotMatch(error.message, /SECRET/);
    return true;
  });
});

test('malformed bridge JSON is a safe fixed error, never an HTML/device payload snippet', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('SECRET-malformed-bridge-output'));
  await assert.rejects(fetchJson('http://127.0.0.1:9333', '/json'), error => {
    assert.equal(error.code, 'invalid_bridge');
    assert.equal(error.message, 'Bridge returned invalid JSON.');
    return true;
  });
});

test('custom cancellation reasons during bridge I/O remain cancelled and never gain retry guidance', async t => {
  for (const reason of ['SECRET-custom-stop', null, Object.assign(new Error('SECRET-custom-stop'), { code: 'bridge_http_error' })]) {
    const ac = new AbortController();
    const s = service(t, undefined, { fetchJson: async () => { ac.abort(reason); throw reason; } });
    await assert.rejects(s.execute('connect', connect, { owner: 'test', signal: ac.signal }), error => {
      assert.equal(error.code, 'cancelled');
      assert.equal(error.message, 'Operation cancelled.');
      assert.equal(recoveryMessage(error.code, 'connect'), '');
      return true;
    });
  }
});

test('recovery text is fixed and does not advise rerouting refused/cancelled work', () => {
  assert.match(recoveryMessage('python_error', 'devices'), /ios_preflight/);
  assert.match(recoveryMessage('ios-environment/runtime_offline', 'environment'), /下一步/);
  assert.match(recoveryMessage('bridge_http_error', 'connect'), /不要自动启动/);
  assert.match(recoveryMessage('target_not_found', 'bind'), /空列表不能证明/);
  for (const code of ['approval_denied', 'approval_unavailable', 'cancelled', 'service_disposed', 'SECRET-unknown']) assert.equal(recoveryMessage(code, 'connect'), '');
  assert.equal(recoveryMessage('target_not_found', 'read'), '');
});
