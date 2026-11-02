import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { z } from 'zod';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access';
import * as remoteClient from '@deepseek-ai/dsh-api-gateway/client';
import { registerIosEnvironment } from '../src/host/environment-service.mjs';
import { EnvironmentSnapshotSchema, environmentInvocations } from '../src/typert-environment.mjs';

// A deterministic React hook seam for operation and disposal checks. It is not a
// browser/visual test, and no Harness UI package or second web server is loaded.
function hookRuntime() {
  const hooks = [];
  let index = 0;
  let effects = [];
  let component;
  let props;
  const React = {
    createElement(type, attrs, ...children) { return { type, props: { ...attrs, children } }; },
    useState(initial) {
      const i = index++;
      hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }];
    },
    useRef(initial) { const i = index++; hooks[i] ??= { value: { current: initial } }; return hooks[i].value; },
    useId() { const i = index++; hooks[i] ??= { value: 'isolated-panel-' + i }; return hooks[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { index++; return snapshot(); },
    useEffect(fn, deps) {
      const i = index++;
      const old = hooks[i];
      if (!old || deps.some((value, j) => old.deps[j] !== value)) {
        hooks[i] = { deps, off: old?.off };
        effects.push(() => { old?.off?.(); hooks[i].off = fn(); });
      }
    },
  };
  return {
    React,
    render(next = component, value = props ?? {}) {
      component = next; props = value; index = 0;
      const tree = component(props);
      const pending = effects; effects = [];
      for (const effect of pending) effect();
      return tree;
    },
    unmount() { for (const hook of hooks) hook?.off?.(); },
  };
}
async function loadFactory(React = {}) {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  let definition;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { assert.equal(definition, undefined); definition = value; } } },
    AbortController, AbortSignal, console,
  }, { filename: 'client.js' });
  assert.equal(definition.id, 'dsh-ios-webview-app-control');
  const imports = [];
  const plugin = definition.factory(name => {
    imports.push(name);
    if (name === 'react') return React;
    if (name === 'zod') return { z };
    throw new Error('Forbidden Client import: ' + name);
  });
  return { definition, plugin, imports, source };
}
function flatten(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(flatten);
  return [tree, ...flatten(tree?.props?.children)];
}
function button(tree, text) {
  const found = flatten(tree).find(node => node.type === 'button' && node.props.children.includes(text));
  assert.ok(found, 'missing button ' + text);
  return found;
}
function textOf(tree) { return flatten(tree).filter(value => typeof value === 'string').join('\n'); }
const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeManager() {
  let state = { phase: 'unprepared', busy: false, step: 'unprepared', python: null, progress: null, error: null };
  const listeners = new Set();
  const calls = [];
  let finishPreparation;
  return {
    calls, listeners,
    status() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    publish(patch) { state = { ...state, ...patch }; for (const listener of listeners) listener(state); },
    prepare({ signal }) {
      calls.push(['prepare', signal]);
      this.publish({ phase: 'downloading', busy: true, step: 'download', progress: { completedBytes: 123, totalBytes: 456 } });
      return new Promise(resolve => { finishPreparation = resolve; signal.addEventListener('abort', () => resolve(state), { once: true }); });
    },
    cancel() { calls.push(['cancel']); this.publish({ phase: 'cancelled', busy: false, step: 'cancelled' }); finishPreparation?.(state); },
    cleanup() { calls.push(['cleanup']); this.publish({ phase: 'unprepared', busy: false, step: 'unprepared' }); },
  };
}
function localeFixture() {
  let registered;
  const state = { active: 'zh', revision: 0 };
  return {
    state,
    get registered() { return registered; },
    register(ns, dicts) { registered = { ns, dicts }; return () => { registered = undefined; }; },
    bind() { return (key, params) => { let value = registered?.dicts[state.active]?.[key] ?? key; for (const [k, v] of Object.entries(params ?? {})) value = value.replaceAll(`{${k}}`, String(v)); return value; }; },
    subscribe() { return () => {}; }, getSnapshot() { return state; },
  };
}
async function fixture(t) {
  const host = new Context();
  await host.plugin(TypertRegistry);
  await host.plugin(RemoteAccessService);
  await host.plugin(TypertGatewayService, {});
  const manager = fakeManager();
  await host.plugin({ apply(ctx) { registerIosEnvironment(ctx, { manager }); } });
  const peer = { id: 'isolated-ui-owner', ctx: host, principal: { kind: 'owner' }, signal: new AbortController().signal, interactions: 'none', dispose: async () => {} };
  const client = new Context();
  const carriers = [];
  await client.plugin(TypertRegistry);
  client.provide('connection', {
    interactions: 'none', isLoopback: true,
    rpc: {
      async call(channel, endpoint, payload, signal) {
        assert.equal(channel, '/api'); carriers.push(endpoint);
        const [namespace, method] = endpoint.split('/');
        try { return { ok: true, value: await host.typertGateway.invoke({ namespace, method, args: payload.args, peer, signal }) }; }
        catch (error) { return { ok: false, error: { code: error.code ?? 'gateway/internal', message: error.message, details: {} } }; }
      },
      async *open(channel, endpoint, payload, signal) {
        assert.equal(channel, '/api'); carriers.push(endpoint);
        const [namespace, method] = endpoint.split('/');
        yield* await host.typertGateway.stream({ namespace, method, args: payload.args, peer, signal });
      },
    },
  });
  await client.plugin(remoteClient);
  const entries = new Map();
  client.provide('slots', {
    inject(_owner, callback) { return callback(); },
    register(options, component) { entries.set(options.name, { options, component }); return () => entries.delete(options.name); },
  });
  const locale = localeFixture();
  client.provide('locale', locale);
  const runtime = hookRuntime();
  const { plugin, imports, source } = await loadFactory(runtime.React);
  const fiber = await client.plugin(plugin);
  t.after(async () => { runtime.unmount(); await client.fiber.dispose(); await host.fiber.dispose(); });
  return { host, client, manager, entries, locale, runtime, fiber, carriers, imports, source };
}

test('browser factory is lazy, owns only React/zod imports, mounts real strict Client descriptors', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.imports, ['react', 'zod']);
  assert.doesNotMatch(f.source, /require\(['"]@deepseek-ai/);
  assert.doesNotMatch(f.source, /iframe|document\.body|fetch\(/);
  assert.deepEqual(f.carriers, [], 'apply does not prepare, read devices or even start a follow');
  assert.deepEqual(f.manager.calls, []);
  const descriptors = f.client.typert.remotes.list();
  assert.equal(descriptors.length, 5);
  for (const host of environmentInvocations) {
    const client = descriptors.find(item => item.method === host.method);
    assert.equal(client.id, host.id);
    assert.equal(client.result.mode, 'strict');
    assert.equal(client.result.typeSymbol, host.result.typeSymbol);
    assert.equal(client.parameters.length, 0);
    const example = { phase: 'ready', step: 'ready', busy: false, python: { path: '/private/python', version: '3.13.9', source: 'private', abi: 'cp313' }, pymobiledevice3: '11.45.0' };
    assert.deepEqual(client.result.create().parse(example), EnvironmentSnapshotSchema.parse(example));
    assert.throws(() => client.result.create().parse({ ...example, owner: true }));
  }
  const settings = f.entries.get('settings.plugins.tab');
  assert.equal(settings.options.id, 'ios-environment');
  assert.equal(settings.options.label(), 'iOS 环境');
  assert.equal(f.entries.get('plugins.bundle.activation').options.key, 'dsh-ios-webview-app-control');
  assert.deepEqual(Object.keys(f.locale.registered.dicts.zh).sort(), Object.keys(f.locale.registered.dicts.en).sort());
  await f.fiber.dispose();
  assert.equal(f.entries.size, 0);
  assert.equal(f.client.typert.remotes.list().length, 0);
  assert.equal(f.locale.registered, undefined);
});

test('mounted UI follows status only; human prepare and cancel call the same real Host operations', async t => {
  const f = await fixture(t);
  const component = f.entries.get('settings.plugins.tab').component;
  let tree = f.runtime.render(component);
  assert.match(textOf(tree), /正在读取环境状态/);
  await settle();
  tree = f.runtime.render();
  assert.equal(f.manager.listeners.size, 1);
  assert.deepEqual(f.carriers, ['iosEnvironment/follow']);
  assert.deepEqual(f.manager.calls, []);
  button(tree, '准备环境').props.onClick();
  await settle();
  tree = f.runtime.render();
  assert.equal(f.manager.calls[0][0], 'prepare');
  assert.equal(button(tree, '准备环境').props.disabled, true);
  assert.equal(button(tree, '取消准备').props.disabled, false, 'cancel remains usable during pending prepare RPC');
  assert.match(textOf(tree), /123 \/ 456 字节/);
  button(tree, '取消准备').props.onClick();
  await settle();
  tree = f.runtime.render();
  assert.deepEqual(f.manager.calls.map(([name]) => name), ['prepare', 'cancel']);
  assert.match(textOf(tree), /已取消/);
  assert.deepEqual(f.carriers, ['iosEnvironment/follow', 'iosEnvironment/prepare', 'iosEnvironment/cancel']);
  f.runtime.unmount();
  await settle();
  assert.equal(f.manager.listeners.size, 0);
});

test('cleanup requires an explicit confirm click; back/Escape do not call the Host', async t => {
  const f = await fixture(t);
  f.runtime.render(f.entries.get('settings.plugins.tab').component);
  await settle();
  let tree = f.runtime.render();
  button(tree, '清理闲置环境').props.onClick();
  tree = f.runtime.render();
  assert.equal(flatten(tree).filter(node => node?.props?.role === 'alertdialog').length, 1);
  assert.deepEqual(f.manager.calls, []);
  button(tree, '保留环境').props.onClick();
  tree = f.runtime.render();
  assert.equal(flatten(tree).some(node => node?.props?.role === 'alertdialog'), false);
  button(tree, '清理闲置环境').props.onClick();
  tree = f.runtime.render();
  const confirm = flatten(tree).find(node => node?.props?.role === 'alertdialog');
  confirm.props.onKeyDown({ key: 'Escape', preventDefault() {} });
  tree = f.runtime.render();
  assert.deepEqual(f.manager.calls, []);
  button(tree, '清理闲置环境').props.onClick();
  tree = f.runtime.render();
  button(tree, '确认清理').props.onClick();
  await settle();
  f.runtime.render();
  assert.deepEqual(f.manager.calls.map(([name]) => name), ['cleanup']);
});

test('failure and phase/error details render as React text; English copy and theme are native', async t => {
  const f = await fixture(t);
  f.runtime.render(f.entries.get('settings.plugins.tab').component);
  await settle();
  f.manager.publish({ phase: 'failed', step: 'verification', error: { code: 'verify', message: '<script>not markup</script>' } });
  await settle();
  let tree = f.runtime.render();
  assert.match(textOf(tree), /准备失败/);
  assert.match(textOf(tree), /<script>not markup<\/script>/);
  assert.equal(flatten(tree).some(node => node?.type === 'script'), false);
  assert.equal(button(tree, '重试准备').props.disabled, false);
  f.locale.state.active = 'en';
  tree = f.runtime.render();
  assert.match(textOf(tree), /Preparation failed/);
  assert.match(textOf(tree), /This plugin provides iOS WebView/);
  assert.match(textOf(tree), /not a DSH\/session tool inventory/);
  assert.match(f.source, /--dsw-alias-label-primary/);
  assert.match(f.source, /--dsw-alias-bg-layer-1/);
  assert.doesNotMatch(f.source, /#[0-9a-fA-F]{3,8}\b/);
});
