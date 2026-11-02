import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access';
import { createIosEnvironmentController, registerIosEnvironment } from '../src/host/environment-service.mjs';
import { EnvironmentSnapshotSchema, environmentHostContribution, environmentInvocations, projectEnvironmentSnapshot } from '../src/typert-environment.mjs';

const initial = () => ({ phase: 'unprepared', busy: false, step: 'unprepared', python: null, progress: null, error: null });
function fakeManager() {
  let state = initial();
  const calls = [];
  const listeners = new Set();
  return {
    calls, listeners,
    status() { calls.push(['status']); return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    publish(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
    async prepare({ signal }) {
      calls.push(['prepare', signal]); signal.throwIfAborted();
      this.publish({ phase: 'ready', step: 'ready', busy: false, python: { path: '/private/python', version: '3.13.9', source: 'private', abi: 'cp313' }, pymobiledevice3: '11.45.0' });
      return state;
    },
    async cancel() { calls.push(['cancel']); this.publish({ phase: 'cancelled', step: 'cancelled', busy: false }); },
    async cleanup() { calls.push(['cleanup']); state = initial(); this.publish({}); },
    async dispose() { calls.push(['dispose']); },
  };
}
async function isolatedHost(t, { manager = fakeManager() } = {}) {
  const root = new Context();
  await root.plugin(TypertRegistry);
  await root.plugin(RemoteAccessService);
  await root.plugin(TypertGatewayService, {});
  let registration;
  const fiber = await root.plugin({ apply(ctx) { registration = registerIosEnvironment(ctx, { manager }); } });
  const peerRoot = new Context();
  const ac = new AbortController();
  const peer = { id: 'isolated-owner', ctx: peerRoot, principal: { kind: 'owner' }, signal: ac.signal, interactions: 'none', async dispose() { ac.abort(); await peerRoot.fiber.dispose(); } };
  t.after(async () => { await peer.dispose(); await root.fiber.dispose(); });
  const invoke = (method, args = {}, options = {}) => root.typertGateway.invoke({ namespace: 'iosEnvironment', method, args, peer, ...options });
  const stream = (options = {}) => root.typertGateway.stream({ namespace: 'iosEnvironment', method: 'follow', args: {}, peer, ...options });
  return { root, manager, registration, fiber, peer, invoke, stream };
}

test('public snapshot is strict, lossless and a whitelist, not arbitrary manager state', () => {
  const raw = { ...initial(), env: { TOKEN: 'secret' }, argv: ['secret'], endpoint: 'secret', python: { path: '/python', version: '3.13.9', source: 'host', abi: 'cp313', env: 'secret' }, error: { code: 'fixed-code', message: 'safe diagnostic', stderr: 'secret' } };
  const publicState = projectEnvironmentSnapshot(raw);
  assert.deepEqual(Object.keys(publicState).sort(), ['busy', 'error', 'phase', 'progress', 'python', 'step']);
  assert.equal(JSON.stringify(publicState).includes('secret'), false);
  assert.throws(() => EnvironmentSnapshotSchema.parse({ ...initial(), owner: true }));
  for (const invalid of [NaN, Infinity, -1, 1.5]) assert.throws(() => projectEnvironmentSnapshot({ ...initial(), progress: { completedBytes: invalid } }));
  assert.throws(() => projectEnvironmentSnapshot({ ...initial(), phase: 'connected-device' }));
});

test('shared controller dispatches exact manager methods, never prepares on creation or observation', async t => {
  const manager = fakeManager();
  const controller = createIosEnvironmentController(manager);
  t.after(() => controller.dispose());
  assert.deepEqual(manager.calls, []);
  assert.equal((await controller.execute('status')).phase, 'unprepared');
  assert.deepEqual(manager.calls, [['status']]);
  const signal = new AbortController().signal;
  assert.equal((await controller.execute('prepare', { signal })).phase, 'ready');
  const forwarded = manager.calls.find(([name]) => name === 'prepare')[1];
  assert.ok(forwarded instanceof AbortSignal);
  assert.equal(forwarded.aborted, false);
  assert.equal((await controller.execute('cancel')).phase, 'cancelled');
  assert.equal((await controller.execute('cleanup')).phase, 'unprepared');
  assert.deepEqual(manager.calls.filter(([name]) => name !== 'status').map(([name]) => name), ['prepare', 'cancel', 'cleanup']);
  await assert.rejects(controller.execute('devices'), { code: 'ios-environment/invalid-action' });
  for (const options of [null, [], { owner: true }, { signal: {} }, { signal, pythonPath: '/untrusted' }]) await assert.rejects(controller.execute('prepare', options));
  await controller.dispose();
  assert.equal(manager.calls.some(([name]) => name === 'dispose'), false, 'parent owns manager lifetime');
  await assert.rejects(controller.execute('status'), { code: 'ios-environment/disposed' });
});

test('follow subscribes before baseline, coalesces, supports immediate return and no device work', async t => {
  const manager = fakeManager();
  const controller = createIosEnvironmentController(manager);
  t.after(() => controller.dispose());
  const follow = controller.follow();
  assert.equal(manager.listeners.size, 1);
  assert.equal((await follow.next()).value.phase, 'unprepared');
  manager.publish({ phase: 'checking', busy: true });
  manager.publish({ phase: 'downloading', progress: { completedBytes: 1 } });
  assert.equal((await follow.next()).value.phase, 'downloading');
  const blocked = follow.next();
  await follow.return();
  assert.deepEqual(await blocked, { done: true, value: undefined });
  assert.equal(manager.listeners.size, 0);
  const unconsumed = controller.follow();
  assert.equal(manager.listeners.size, 1);
  await unconsumed.return();
  assert.equal(manager.listeners.size, 0);
  assert.equal(manager.calls.every(([name]) => name === 'status'), true);
});

test('follow cancellation and controller disposal release listeners while reads are pending', async () => {
  const manager = fakeManager();
  const controller = createIosEnvironmentController(manager);
  const ac = new AbortController();
  const follower = controller.follow(ac.signal);
  await follower.next();
  const waiting = follower.next();
  ac.abort();
  assert.equal((await waiting).done, true);
  assert.equal(manager.listeners.size, 0);
  const another = controller.follow();
  await another.next();
  const read = another.next();
  await controller.dispose();
  assert.equal((await read).done, true);
  assert.equal(manager.listeners.size, 0);
});

test('manager failures expose only structured public status and cancellation is not disguised', async t => {
  const manager = fakeManager();
  manager.prepare = async () => { manager.publish({ phase: 'failed', error: { code: 'network', message: 'Download unavailable.' } }); throw new Error('SECRET_STDERR'); };
  const controller = createIosEnvironmentController(manager);
  t.after(() => controller.dispose());
  await assert.rejects(controller.execute('prepare'), error => {
    assert.equal(error.code, 'ios-environment/network');
    assert.equal(error.message, 'Download unavailable.');
    assert.doesNotMatch(error.message, /SECRET_STDERR/);
    return true;
  });
  const ac = new AbortController();
  const reason = new Error('cancelled explicitly');
  ac.abort(reason);
  await assert.rejects(controller.execute('prepare', { signal: ac.signal }), error => error === reason);
});

test('real Typert registry contributes all strict endpoints and real binding passes Gateway', async t => {
  const h = await isolatedHost(t);
  assert.equal(h.root.typert.getPackage('dsh-ios-webview-app-control').model.services[0].key, 'iosEnvironment');
  for (const descriptor of environmentInvocations) {
    const actual = h.root.typert.local.get(`iosEnvironment/${descriptor.method}`);
    assert.equal(actual.result.mode, 'strict');
    assert.deepEqual(actual.parameters, []);
    assert.deepEqual(actual.cancellation, { parameter: 'signal' });
  }
  assert.equal(environmentHostContribution.invocations.some(({ method }) => method === 'execute'), false);
  const state = await h.invoke('status');
  assert.equal(state.phase, 'unprepared');
  assert.equal((await h.invoke('prepare')).phase, 'ready');
  assert.equal((await h.invoke('cancel')).phase, 'cancelled');
  assert.equal((await h.invoke('cleanup')).phase, 'unprepared');
  assert.equal(h.manager.calls.some(([name]) => name === 'dispose'), false);
});

test('every Remote wrapper refuses absent/non-owner invocations even after a status read', async t => {
  const h = await isolatedHost(t);
  await h.invoke('status');
  const service = h.registration.service;
  for (const method of ['status', 'prepare', 'cancel', 'cleanup', 'follow']) {
    assert.throws(() => service[method](new AbortController().signal), { code: 'ios-environment/owner-required' });
  }
  // Deliberately permissive Gateway seam proves the business owner check remains.
  const off = h.root.remoteAccess.registerPolicy('test-reader', {
    bindings: () => [{ resource: { kind: 'global' }, role: { actions: ['iosEnvironment/status', 'iosEnvironment/prepare', 'iosEnvironment/cancel', 'iosEnvironment/cleanup', 'iosEnvironment/follow'] } }],
  });
  t.after(off);
  const nonowner = { ...h.peer, principal: { kind: 'test-reader' } };
  for (const method of ['status', 'prepare', 'cancel', 'cleanup']) {
    await assert.rejects(h.invoke(method, {}, { peer: nonowner }), { code: 'ios-environment/owner-required' });
  }
  assert.equal(h.manager.calls.some(([name]) => ['prepare', 'cancel', 'cleanup'].includes(name)), false);
});

test('Gateway rejects extra authority fields, hidden execute, unknown methods and disposed Peer', async t => {
  const h = await isolatedHost(t);
  for (const args of [{ owner: true }, { signal: 'fake' }, { confirmed: true }, { action: 'prepare' }, { pythonPath: '/attacker' }]) {
    await assert.rejects(h.invoke('prepare', args), { code: 'gateway/arguments-invalid' });
  }
  for (const method of ['execute', 'requirePython', 'dispose', 'devices']) await assert.rejects(h.invoke(method), { code: 'gateway/invocation-unavailable' });
  await h.peer.dispose();
  await assert.rejects(h.invoke('prepare'), { code: 'gateway/peer-disposed' });
  assert.equal(h.manager.calls.some(([name]) => name !== 'status'), false);
});

test('real Gateway stream yields baseline/progress and unregister fails closed, never SRC fallback', async t => {
  const h = await isolatedHost(t);
  const ac = new AbortController();
  const source = await h.stream({ signal: ac.signal });
  const iterator = source[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.phase, 'unprepared');
  h.manager.publish({ phase: 'checking', busy: true, step: 'probe' });
  assert.equal((await iterator.next()).value.phase, 'checking');
  ac.abort();
  await assert.rejects(iterator.next(), { code: 'gateway/cancelled' });
  assert.equal(h.manager.listeners.size, 0);
  await h.registration.dispose();
  await assert.rejects(h.invoke('status'), { code: 'gateway/definition-unavailable' });
  assert.equal(h.manager.calls.some(([name]) => name === 'dispose'), false);
  await h.fiber.dispose();
  assert.equal(h.root.get('iosEnvironment'), undefined);
});
