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

test('first-use checklist is equivalent in both locales and never adds device or preparation calls', async t => {
  const f = await fixture(t);
  f.runtime.render(f.entries.get('settings.plugins.tab').component);
  await settle();
  const cases = {
    zh: {
      title: '首次连接检查清单',
      intro: [/软件就绪不等于手机或 App 就绪/, /不会访问设备、自动配对或启动桥接/, /保留在插件设置页/],
      items: [
        [/ios_preflight/, /workflow=device-discovery/, /workflow=existing-bridge/, /只检查本机私有软件环境/, /不访问设备、不自动准备环境/, /不授予设备操作权限/, /已有桥接流程不依赖此 Python 环境就绪/],
        [/支持数据传输的数据线/, /解锁 iPhone \/ iPad/, /由你在设备上处理“信任此电脑”/, /不要让 Agent 自动信任或配对/],
        [/设置 → App → Safari → 高级 → 网页检查器/, /设置 → Safari → 高级 → 网页检查器/, /由你按设备实际界面开启/],
        [/Developer Mode/, /仅在开发签名、调试或当前工具链明确要求时按需开启/, /不是所有 WebView \/ 已有桥接流程都需要/],
        [/App 开发者确认/, /允许 WebView 检查/, /不能替代 App 侧支持/, /目标列表为空可能有多种原因/, /不能据此断定开关已关闭/],
        [/已存在的本机 loopback bridge/, /由你选定精确 UDID/, /确认该桥属于这台设备/, /连接成功不证明桥归属/, /不要让 Agent 新建或启动桥接/],
        [/ios_devices/, /ios_connect → ios_targets/, /人工确认精确 target id、受支持的 App 类型与 App 身份/, /ios_bind_target → ios_acquire/, /每次设备调用均需单独的一次性审批/, /未获审批不得执行或绕过/, /新目标或导航后需重新列出并显式绑定/],
      ],
    },
    en: {
      title: 'First connection checklist',
      intro: [/Software readiness does not mean your phone or app is ready/, /does not access devices, pair automatically, or start a bridge/, /remains available in plugin settings/],
      items: [
        [/ios_preflight/, /workflow=device-discovery/, /workflow=existing-bridge/, /only checks the local private software environment/, /does not access devices, prepare the environment automatically, or authorize device operations/, /existing bridge does not require this Python environment to be ready/],
        [/data-capable cable/, /unlock your iPhone \/ iPad/, /handle “Trust This Computer”/, /yourself on the device/, /Do not ask the Agent to trust or pair automatically/],
        [/Settings → Apps → Safari → Advanced → Web Inspector/, /Settings → Safari → Advanced → Web Inspector/, /Enable it yourself/],
        [/Developer Mode only when development signing, debugging, or your current toolchain explicitly requires it/, /Not every WebView \/ existing-bridge workflow needs it/],
        [/app developer to confirm/, /allows WebView inspection/, /cannot replace app-side support/, /empty target list can have multiple causes/, /does not prove that the switch is off/],
        [/existing local loopback bridge/, /Select the exact UDID yourself/, /confirm that the bridge belongs to that device/, /successful connection does not prove bridge ownership/, /Do not ask the Agent to create or start a bridge/],
        [/ios_devices/, /ios_connect → ios_targets/, /confirm the exact target id, supported app type, and app identity yourself/, /ios_bind_target → ios_acquire/, /Every device call requires separate one-shot approval/, /without it, do not execute or bypass/, /Relist and explicitly rebind after a new target or navigation/],
      ],
    },
  };
  for (const [locale, expected] of Object.entries(cases)) {
    f.locale.state.active = locale;
    const tree = f.runtime.render();
    const checklist = flatten(tree).find(node => node?.type === 'section' && node.props.className?.includes('iosenv-firstuse'));
    assert.ok(checklist, locale + ' checklist');
    const title = flatten(checklist).find(node => node?.type === 'h4');
    assert.equal(textOf(title), expected.title);
    assert.equal(checklist.props['aria-labelledby'], title.props.id);
    const intro = flatten(checklist).find(node => node?.type === 'p');
    for (const pattern of expected.intro) assert.match(textOf(intro), pattern);
    const list = flatten(checklist).find(node => node?.type === 'ol');
    assert.ok(list);
    const items = flatten(list).filter(node => node?.type === 'li');
    assert.equal(items.length, expected.items.length);
    items.forEach((item, index) => {
      for (const pattern of expected.items[index]) assert.match(textOf(item), pattern);
    });
    assert.equal(flatten(checklist).some(node => ['button', 'input', 'iframe'].includes(node?.type) || node?.props?.onClick), false, 'guidance is static text, not a device action');
  }
  assert.deepEqual(f.carriers, ['iosEnvironment/follow']);
  assert.deepEqual(f.manager.calls, []);
});

test('settings retains the first-use checklist independently of environment readiness', async t => {
  const f = await fixture(t);
  let dismissed = 0;
  f.runtime.render(f.entries.get('settings.plugins.tab').component, { onDismiss() { dismissed += 1; } });
  await settle();
  for (const phase of ['unprepared', 'ready', 'failed', 'cancelled']) {
    f.manager.publish({ phase, busy: false });
    await settle();
    const tree = f.runtime.render();
    assert.match(textOf(tree), /首次连接检查清单/);
    assert.match(textOf(tree), /软件就绪不等于手机或 App 就绪/);
    assert.match(textOf(tree), /ios_preflight/);
    assert.equal(flatten(tree).filter(node => node?.type === 'li').length, 7);
  }
  assert.equal(dismissed, 0, 'settings never uses the activation auto-dismiss');
  assert.deepEqual(f.carriers, ['iosEnvironment/follow']);
  assert.deepEqual(f.manager.calls, []);
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

test('activation guidance dismisses itself once the environment is ready', async t => {
  const f = await fixture(t);
  const entry = f.entries.get('plugins.bundle.activation');
  let dismissed = 0;
  const hostProps = { packageName: 'dsh-ios-webview-app-control', onDismiss: () => { dismissed += 1; }, onOpenDetails() {} };
  const element = entry.component(hostProps);
  assert.equal(element.props.activation, true);
  const panel = element.type;
  const props = element.props;
  f.runtime.render(panel, props);
  await settle();
  const initialTree = f.runtime.render(panel, props);
  assert.equal(dismissed, 0, 'an unprepared environment keeps the activation guidance open');
  assert.match(textOf(initialTree), /首次连接检查清单/);
  f.manager.publish({ phase: 'ready', busy: true });
  await settle();
  f.runtime.render(panel, props);
  assert.equal(dismissed, 0, 'a busy ready snapshot does not dismiss the activation guidance');
  f.manager.publish({ phase: 'ready', busy: false, step: 'reused', progress: { completedBytes: 0, totalBytes: 0 } });
  await settle();
  const tree = f.runtime.render(panel, props);
  assert.equal(dismissed, 1, 'a ready environment dismisses the activation guidance');
  assert.match(textOf(tree), /首次连接检查清单/);
  f.runtime.render(panel, { ...props, onDismiss: () => { dismissed += 1; } });
  assert.equal(dismissed, 1, 'the activation guidance dismisses only once');
  assert.deepEqual(f.carriers, ['iosEnvironment/follow']);
  assert.deepEqual(f.manager.calls, []);
  assert.match(textOf(tree), /本机环境已就绪/);
  assert.doesNotMatch(textOf(tree), /字节/);
  assert.doesNotMatch(textOf(tree), /步骤/);
  assert.equal(flatten(tree).some(node => node?.type === 'progress'), false);
});

test('a settled panel keeps environment facts but no preparation step or progress', async t => {
  const f = await fixture(t);
  f.runtime.render(f.entries.get('settings.plugins.tab').component);
  await settle();
  f.manager.publish({ phase: 'ready', busy: false, step: 'reused', progress: { completedBytes: 7, totalBytes: 9 } });
  await settle();
  const tree = f.runtime.render();
  assert.match(textOf(tree), /本机环境已就绪/);
  assert.doesNotMatch(textOf(tree), /字节/);
  assert.doesNotMatch(textOf(tree), /步骤/);
  assert.equal(flatten(tree).some(node => node?.type === 'progress'), false);
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
