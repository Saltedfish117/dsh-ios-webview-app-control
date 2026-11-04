import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { EnvironmentManager } from '../src/runtime/environment-manager.mjs';
import { IosControl } from '../src/core/service.mjs';
import { IosError } from '../src/core/protocol.mjs';
import * as plugin from '../src/plugin.mjs';

async function host(t, { policy = 'never', outcome = 'allowed-once', ready = true, failure } = {}) {
  let verifies = 0, prepares = 0, asks = 0, io = 0;
  t.mock.method(globalThis, 'fetch', async () => { io++; throw Error('No live network/device access in preflight tool tests'); });
  t.mock.method(EnvironmentManager.prototype, 'status', () => ({ phase: ready ? 'ready' : 'unprepared', busy: false }));
  t.mock.method(EnvironmentManager.prototype, 'requirePython', async ({ signal }) => { verifies++; signal.throwIfAborted(); if (!ready) throw new IosError('environment_not_ready', 'private diagnostic SECRET'); return 'mock-private'; });
  t.mock.method(EnvironmentManager.prototype, 'prepare', async () => { prepares++; throw Error('No setup in preflight'); });
  if (failure) t.mock.method(IosControl.prototype, 'execute', async () => { throw failure; });
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, { mode: 'native' });
  ctx.provide('approval', { config: { policy }, overrideOf: () => undefined, request: async () => { asks++; return outcome; } });
  await ctx.plugin(plugin, { runtime: { autoPrepare: false } });
  const agent = { session: { id: 'preflight-tool-test' } }; let seq = 0;
  return { ctx, agent, counts: () => ({ verifies, prepares, asks, io }), call: (name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: 'preflight-' + (++seq) }) };
}

test('local preflight is available under never but cannot authorize any device operation', async t => {
  const h = await host(t);
  const r = await h.call('ios_preflight', { workflow: 'device-discovery' });
  assert.equal(r.isError, false);
  assert.equal(r.value.preflight.checks.find(check => check.id === 'software_runtime').status, 'passed');
  assert.equal(r.value.preflight.deviceAccessPerformed, false);
  assert.equal(r.value.preflight.authorizationGranted, false);
  const denied = await h.call('ios_devices');
  assert.equal(denied.isError, true); assert.equal(denied.error.info.code, 'approval_denied');
  assert.deepEqual(h.counts(), { verifies: 1, prepares: 0, asks: 0, io: 0 });
});

test('existing-bridge local preflight skips Python and does not even ping endpoint', async t => {
  const h = await host(t, { ready: false });
  const r = await h.call('ios_preflight', { workflow: 'existing-bridge' });
  assert.equal(r.isError, false);
  assert.equal(r.value.preflight.checks.find(check => check.id === 'software_runtime').status, 'not_applicable');
  assert.deepEqual(h.counts(), { verifies: 0, prepares: 0, asks: 0, io: 0 });
});

test('unready environment produces fixed actionable checks rather than leaking local errors', async t => {
  const h = await host(t, { ready: false });
  const r = await h.call('ios_preflight', { workflow: 'device-discovery' });
  assert.equal(r.isError, false);
  assert.equal(r.value.preflight.checks.find(check => check.id === 'software_runtime').status, 'failed');
  assert.ok(r.value.preflight.nextActions.some(action => action.tool === 'ios_environment'));
  assert.doesNotMatch(JSON.stringify(r.value), /SECRET/);
  assert.deepEqual(h.counts(), { verifies: 1, prepares: 0, asks: 0, io: 0 });
});

test('preflight requires workflow and refuses hidden backend/approval/target overrides before execution', async t => {
  const h = await host(t);
  for (const args of [{}, { workflow: 'native' }, { workflow: 1 }, ...['endpoint', 'udid', 'targetId', 'approved', 'owner', 'pythonPath', 'allowEval'].map(key => ({ workflow: 'existing-bridge', [key]: 'untrusted' }))]) {
    const r = await h.call('ios_preflight', args); assert.equal(r.isError, true);
  }
  const ac = new AbortController(); ac.abort();
  const cancelled = await h.call('ios_preflight', { workflow: 'device-discovery' }, ac.signal);
  assert.equal(cancelled.isError, true);
  assert.deepEqual(h.counts(), { verifies: 0, prepares: 0, asks: 0, io: 0 });
});

test('automatic prompt includes first-use manual setup, evidence limits and recheck gates', async t => {
  const h = await host(t);
  const assembly = await h.ctx.systemPrompt.assemble({ scope: h.agent });
  assert.equal(assembly.tools.length, 14);
  const text = assembly.sections.find(section => section.name === 'tool:ios-webview-app-control').text;
  for (const word of ['ios_preflight', 'device-discovery', 'existing-bridge', 'Trust', 'Safari', 'Web Inspector', 'Developer Mode', 'conditional', 'inspectable', 'unknown is not failed', 'not_checked is not passed', 'no automatic retry loops', 'fresh approval']) assert.ok(text.includes(word), word);
  assert.match(text, /Never auto-pair, change phone settings, install system drivers or start a bridge/);
});

test('ordinary bridge failure keeps machine code and gains fixed safe next steps', async t => {
  const failure = new IosError('bridge_http_error', 'Bridge returned HTTP 503', { stderr: 'SECRET', token: 'SECRET' });
  const h = await host(t, { policy: 'ask', failure });
  const r = await h.call('ios_connect', { platform: 'ios', appType: 'hybrid', endpoint: 'http://127.0.0.1:9333', udid: 'test', verifiedExistingUdid: 'test' });
  assert.equal(r.isError, true); assert.equal(r.error.info.code, 'bridge_http_error');
  assert.match(r.error.message, /下一步/); assert.match(r.error.message, /不要自动启动/);
  assert.doesNotMatch(r.error.message, /SECRET/); assert.equal(h.counts().asks, 1);
});

test('cancelled or denied checks remain errors without repair/retry instructions', async t => {
  const h = await host(t, { policy: 'ask', outcome: 'rejected' });
  const r = await h.call('ios_devices');
  assert.equal(r.isError, true); assert.equal(r.error.info.code, 'approval_denied');
  assert.doesNotMatch(r.error.message, /下一步|prepare|retry/i);
  assert.deepEqual(h.counts(), { verifies: 0, prepares: 0, asks: 1, io: 0 });
});
