import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { ToolArgsError, parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools';
import { apply, Config, inject, name, TOOL_SPECS } from '../src/plugin.mjs';
import { IosControl } from '../src/core/service.mjs';

// The adapter imports the real npm-installed defineTool. Only host services and
// core transport dispatch are faked; these tests never contact a device/bridge.
const CONNECTION = { connectionId: 'test-session-connection' };
const TARGET = { ...CONNECTION, targetId: 'test-page', leaseToken: 'test-lease' };
const CONNECT = {
  platform: 'ios', appType: 'webview', endpoint: 'http://127.0.0.1:9333',
  udid: 'operator-confirmed-device', verifiedExistingUdid: 'operator-confirmed-device',
};
const BIND = {
  ...CONNECTION, targetId: TARGET.targetId, platform: 'ios', appType: 'webview',
  verifiedTargetId: TARGET.targetId, appIdentity: 'operator-confirmed-example-app',
};
const EXPECTED = [
  ['ios_devices', 'devices', [], {}],
  ['ios_connect', 'connect', ['platform', 'appType', 'udid', 'verifiedExistingUdid'], CONNECT],
  ['ios_targets', 'targets', ['connectionId'], CONNECTION],
  ['ios_bind_target', 'bind', ['connectionId', 'targetId', 'platform', 'appType', 'verifiedTargetId', 'appIdentity'], BIND],
  ['ios_acquire', 'acquire', ['connectionId'], { ...CONNECTION, seconds: 30 }],
  ['ios_release', 'release', ['connectionId', 'leaseToken'], { ...CONNECTION, leaseToken: TARGET.leaseToken }],
  ['ios_read', 'read', ['connectionId', 'targetId', 'leaseToken'], { ...TARGET, selector: 'body', limit: 1000 }],
  ['ios_screenshot', 'screenshot', ['connectionId', 'targetId', 'leaseToken'], TARGET],
  ['ios_eval', 'eval', ['connectionId', 'targetId', 'leaseToken', 'expression'], { ...TARGET, expression: '1 + 1' }],
  ['ios_dom_action', 'dom', ['connectionId', 'targetId', 'leaseToken', 'action'], { ...TARGET, action: 'click', selector: 'button' }],
  ['ios_disconnect', 'disconnect', ['connectionId'], CONNECTION],
  ['ios_environment', 'environment', ['action'], {action:'status'}],
  ['ios_capabilities', 'capabilities', [], {}],
];

function execution(overrides = {}) {
  return {
    callId: 'test-call', agent: { session: { id: 'exact-owning-session-id' } },
    signal: new AbortController().signal, ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function captureCore(t, impl = async action => ({ ok: true, action })) {
  const calls = [];
  t.mock.method(IosControl.prototype, 'execute', async function (action, args, exec) {
    const call = { action, args, exec, service: this };
    calls.push(call);
    return impl.call(this, action, args, exec);
  });
  return calls;
}

function harness(t, options = {}) {
  const tools = new Map();
  const registrations = [];
  const sections = [];
  const events = [];
  const effects = [];
  const approvalCalls = [];
  const policyQueries = [];
  let sessionPolicy = options.sessionPolicy;
  let cleanupPromise;
  const approval = {
    config: { policy: options.policy ?? 'ask' },
    overrideOf(session) { policyQueries.push(session); return sessionPolicy; },
    async request(req) {
      approvalCalls.push(req);
      events.push('approval:' + req.toolName);
      if (options.request) return options.request(req);
      return Object.hasOwn(options, 'outcome') ? options.outcome : 'allowed-once';
    },
  };
  const ctx = {
    approval: options.missingApproval ? undefined : approval,
    tools: {
      register(definition) {
        assert.equal(tools.has(definition.name), false, 'no duplicate registration');
        registrations.push(definition);
        tools.set(definition.name, definition);
        const dispose = () => {
          events.push('unregister:' + definition.name);
          tools.delete(definition.name);
        };
        effects.push({ kind: 'tool', dispose });
        return dispose;
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
        const dispose = () => { events.push('remove-section:' + section.name); };
        effects.push({ kind: 'section', dispose });
        return dispose;
      },
    },
    effect(start, label) {
      const produced = start();
      const yielded = typeof produced === 'function' ? [produced] : produced;
      assert.ok(yielded && typeof yielded[Symbol.iterator] === 'function', 'effect returns a disposer or iterable');
      const children = [];
      for (const release of yielded) {
        assert.equal(typeof release, 'function');
        // Actual Cordis removes the exact yielded auto-effect from its sibling
        // ownership list. Nest it here rather than invoking it a second time.
        const index = effects.findIndex(effect => effect.dispose === release);
        children.push(index >= 0 ? effects.splice(index, 1)[0] : { kind: 'core', dispose: release });
      }
      let disposal;
      const dispose = () => {
        if (!disposal) disposal = (async () => {
          for (const child of children.slice().reverse()) await child.dispose();
        })();
        return disposal;
      };
      effects.push({ kind: 'composite', label, dispose, children });
      return dispose;
    },
  };
  function cleanup() {
    if (!cleanupPromise) cleanupPromise = (async () => {
      // Desktop Cordis may dispose sibling effects concurrently. Ordering must
      // come from the adapter's single composite, not the fake host.
      await Promise.all([...effects].map(effect => effect.dispose()));
    })();
    return cleanupPromise;
  }
  t.after(cleanup);
  apply(ctx, options.config ?? {});
  return {
    ctx, approval, approvalCalls, policyQueries, tools, registrations, sections, effects, events,
    cleanup, setSessionPolicy(value) { sessionPolicy = value; },
    run(toolName, args = {}, exec = execution()) {
      const definition = tools.get(toolName);
      assert.ok(definition, 'tool must be registered: ' + toolName);
      return definition.execute(args, exec);
    },
  };
}

// Prototype mocks touch a shared imported class: all tests and subtests stay serial.
describe('Cordis iOS adapter with the actual installed DSH SDK', { concurrency: false }, () => {
  test('named Cordis exports, Schemastery defaults and all thirteen compiled definitions', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    assert.equal(name, 'ios-webview-app-control');
    assert.deepEqual(inject, ['tools', 'approval', 'systemPrompt']);
    assert.deepEqual(Config({}), {
      endpoint: '', pythonPath: '', stateDir: '', allowEval: false,
      timeoutMs: 15000, maxLeaseSeconds: 120,
      runtime:{autoPrepare:true,directory:'',offline:false,timeoutMs:900000},
    });
    assert.equal(h.registrations.length, 13);
    assert.deepEqual(h.registrations.map(tool => tool.name), EXPECTED.map(item => item[0]));
    assert.equal(TOOL_SPECS.length, 13);
    for (const [toolName, action, required] of EXPECTED) {
      const tool = h.tools.get(toolName);
      const spec = TOOL_SPECS.find(item => item.name === toolName);
      assert.equal(spec.action, action);
      assert.deepEqual(tool.parameters, parameterSchemaSpecToJsonSchema(spec.parameters));
      assert.deepEqual(tool.parameters.required ?? [], required);
      assert.equal(tool.parameters.type, 'object');
      // The real SDK's implicit root is open; extras are checked by the adapter.
      assert.equal(tool.parameters.additionalProperties, undefined);
      assert.deepEqual(tool.output.schema, {}); // author type json compiles to {}
      assert.equal(typeof tool.execute, 'function');
      assert.equal(typeof tool.output.render, 'function');
      assert.equal(tool.isConcurrencySafe, undefined);
      assert.equal(tool.timeoutMs, undefined, 'approval is not on a short I/O deadline');
    }
    const connectSchema = h.tools.get('ios_connect').parameters.properties;
    assert.equal(connectSchema.platform.type, 'string');
    assert.equal(connectSchema.platform.enum, undefined);
    assert.equal(connectSchema.appType.type, 'string');
    assert.equal(connectSchema.appType.enum, undefined);
    const bindSchema = h.tools.get('ios_bind_target').parameters.properties;
    for (const property of ['platform', 'appType', 'verifiedTargetId', 'appIdentity']) {
      assert.equal(bindSchema[property].type, 'string');
      assert.equal(bindSchema[property].enum, undefined);
    }
    assert.deepEqual(h.tools.get('ios_dom_action').parameters.properties.action.enum, ['click', 'scroll', 'input']);
    assert.equal(h.tools.get('ios_screenshot').parameters.properties.outputPath, undefined);
    assert.equal(h.sections.length, 1);
    assert.equal(h.sections[0].name, 'tool:ios-webview-app-control');
    assert.equal(Number.isFinite(h.sections[0].order), true);
    for (const word of ['native', 'Flutter', 'React Native', 'Android', 'unknown', 'even if the user insists', 'WDA', 'Appium', 'operator-attested', 'never', 'untrusted']) {
      assert.ok(h.sections[0].text.includes(word), 'prompt includes scope boundary: ' + word);
    }
    assert.match(h.sections[0].text, /ios_connect -> ios_targets -> ios_bind_target -> ios_acquire/);
    assert.match(h.sections[0].text, /connection unbound/);
    assert.match(h.sections[0].text, /only this plugin's ios_\* tools, not the whole DSH session/);
    assert.match(h.sections[0].text, /not a session-wide tool inventory or device connection check/);
    assert.match(h.sections[0].text, /Independently inspect the current session's relevant tool schemas, skills and permissions/);
    assert.match(h.sections[0].text, /same denied operation via raw core\/CLI\/shell or another tool/);
    assert.match(h.sections[0].text, /device-wide bridge/);
    assert.match(h.sections[0].text, /Every new target or navigation requires re-listing and explicit rebind/);
    assert.match(h.sections[0].text, /not automatic app identification/);
    assert.equal(h.effects.length, 1);
    assert.equal(h.effects[0].kind, 'composite');
    assert.equal(h.effects[0].label, 'ios-webview-app-control composite registrations');
    assert.equal(h.effects[0].children.length, 17);
    assert.equal(h.effects[0].children.slice(0,3).every(child=>child.kind==='core'),true);
    assert.equal(h.effects[0].children[3].kind, 'section');
    assert.equal(h.effects[0].children.slice(4).every(child => child.kind === 'tool'), true);
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0, 'applying the plugin does not dispatch anything');
  });

  test('real defineTool rejects every missing required property before authorization', async t => {
    const calls = captureCore(t);
    const h = harness(t, { config: { allowEval: true } });
    for (const [toolName, , required, valid] of EXPECTED) {
      for (const property of required) {
        const args = { ...valid };
        delete args[property];
        await assert.rejects(h.run(toolName, args), error => {
          assert.ok(error instanceof ToolArgsError, toolName + '.' + property);
          assert.equal(error.code, 'INVALID_ARGS');
          return true;
        });
      }
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('real defineTool rejects wrong types, invalid DOM enums and malformed roots', async t => {
    const calls = captureCore(t);
    const h = harness(t, { config: { allowEval: true } });
    const invalid = [
      ['ios_connect', { ...CONNECT, platform: 1 }],
      ['ios_connect', { ...CONNECT, appType: null }],
      ['ios_connect', { ...CONNECT, verifiedExistingUdid: true }],
      ['ios_connect', { ...CONNECT, endpoint: {} }],
      ['ios_bind_target', { ...BIND, platform: 1 }],
      ['ios_bind_target', { ...BIND, appType: null }],
      ['ios_bind_target', { ...BIND, targetId: 7 }],
      ['ios_bind_target', { ...BIND, verifiedTargetId: true }],
      ['ios_bind_target', { ...BIND, appIdentity: {} }],
      ['ios_acquire', { ...CONNECTION, seconds: 1.5 }],
      ['ios_read', { ...TARGET, limit: '1000' }],
      ['ios_screenshot', { ...TARGET, targetId: 7 }],
      ['ios_eval', { ...TARGET, expression: [] }],
      ['ios_dom_action', { ...TARGET, action: 'nativeTap' }],
      ['ios_devices', null], ['ios_devices', []], ['ios_devices', 'not-an-object'],
    ];
    for (const [toolName, args] of invalid) {
      await assert.rejects(h.run(toolName, args), error => error instanceof ToolArgsError);
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  for (const appType of ['native', 'flutter', 'react-native', 'reactnative', 'unknown', '', 'WebView']) {
    test('explicitly refuses unsupported app type before approval/core: ' + JSON.stringify(appType), async t => {
      const calls = captureCore(t);
      const h = harness(t, { outcome: 'allowed-once' });
      await assert.rejects(h.run('ios_connect', { ...CONNECT, appType }), error => {
        assert.equal(error.code, 'unsupported_app_type');
        assert.match(error.message, /This plugin rejects this app type/);
        assert.match(error.message, /Other tools capabilities are not assessed/);
        return true;
      });
      assert.equal(h.approvalCalls.length, 0);
      assert.equal(calls.length, 0);
    });
  }

  for (const platform of ['android', 'unknown', '', 'IOS']) {
    test('explicitly refuses unsupported platform before approval/core: ' + JSON.stringify(platform), async t => {
      const calls = captureCore(t);
      const h = harness(t);
      await assert.rejects(h.run('ios_connect', { ...CONNECT, platform }), { code: 'unsupported_platform' });
      assert.equal(h.approvalCalls.length, 0);
      assert.equal(calls.length, 0);
    });
  }

  for (const appType of ['native', 'flutter', 'react-native', 'reactnative', 'unknown', '', 'WebView']) {
    test('binding refuses unsupported app type before approval/core: ' + JSON.stringify(appType), async t => {
      const calls = captureCore(t);
      const h = harness(t, { outcome: 'allowed-once' });
      await assert.rejects(h.run('ios_bind_target', { ...BIND, appType }), error => {
        assert.equal(error.code, 'unsupported_app_type');
        assert.match(error.message, /This plugin rejects this app type/);
        assert.match(error.message, /Other tools capabilities are not assessed/);
        return true;
      });
      assert.equal(h.approvalCalls.length, 0);
      assert.equal(calls.length, 0);
    });
  }

  for (const platform of ['android', 'unknown', '', 'IOS']) {
    test('binding refuses unsupported platform before approval/core: ' + JSON.stringify(platform), async t => {
      const calls = captureCore(t);
      const h = harness(t);
      await assert.rejects(h.run('ios_bind_target', { ...BIND, platform }), { code: 'unsupported_platform' });
      assert.equal(h.approvalCalls.length, 0);
      assert.equal(calls.length, 0);
    });
  }

  test('requires exact nonempty target confirmation and operator app identity without inference', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    for (const args of [
      { ...BIND, targetId: '' },
      { ...BIND, targetId: ' ', verifiedTargetId: ' ' },
      { ...BIND, verifiedTargetId: 'different-target' },
      { ...BIND, verifiedTargetId: '' },
      { ...BIND, appIdentity: '' },
      { ...BIND, appIdentity: '   ' },
    ]) {
      await assert.rejects(h.run('ios_bind_target', args), { code: 'target_binding_required' });
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('supported connection and device-wide discovery do not authorize a native target binding', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    await h.run('ios_connect', CONNECT);
    await h.run('ios_targets', CONNECTION);
    assert.equal(h.approvalCalls.length, 2);
    assert.equal(calls.length, 2);
    await assert.rejects(h.run('ios_bind_target', { ...BIND, appType: 'native' }), { code: 'unsupported_app_type' });
    await assert.rejects(h.run('ios_bind_target', { ...BIND, appType: 'flutter' }), { code: 'unsupported_app_type' });
    assert.equal(h.approvalCalls.length, 2);
    assert.equal(calls.length, 2);
  });

  test('binding approval identifies exactly the operator-attested target/app without mutating arguments', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    const args = Object.freeze({ ...BIND, appType: 'hybrid', appIdentity: '  Explicit Operator App Name  ' });
    const exec = execution();
    await h.run('ios_bind_target', args, exec);
    assert.deepEqual(calls[0].args, args);
    assert.notEqual(calls[0].args, args);
    assert.equal(calls[0].action, 'bind');
    assert.equal(calls[0].exec.owner, exec.agent.session.id);
    assert.equal(calls[0].exec.signal, exec.signal);
    const req = h.approvalCalls[0];
    assert.equal(req.toolName, 'ios_bind_target');
    assert.equal(req.agent, exec.agent);
    assert.equal(req.signal, exec.signal);
    assert.ok(req.reason.includes(BIND.targetId));
    assert.ok(req.reason.includes(JSON.stringify(args.appIdentity)));
    assert.ok(req.reason.includes('ios/hybrid'));
    assert.match(req.reason, /not automatic app identification/);
    assert.match(req.reason, /no other target on the device-wide bridge is authorized/);
  });

  test('binding and rebinding require their own one-shot grant and never reuse metadata or a grant', async t => {
    const calls = captureCore(t);
    let outcome = 'allowed-once';
    const h = harness(t, { request: async () => outcome });
    await h.run('ios_bind_target', BIND);
    const newTarget = { ...BIND, targetId: 'new-target-after-navigation', verifiedTargetId: 'new-target-after-navigation' };
    for (const denied of ['rejected', 'unavailable', 'cancelled', { allowed: true }]) {
      outcome = denied;
      await assert.rejects(h.run('ios_bind_target', newTarget), { code: 'approval_denied' });
    }
    assert.equal(calls.length, 1);
    assert.equal(h.approvalCalls.length, 5);
    outcome = 'allowed-once';
    await h.run('ios_bind_target', newTarget);
    assert.equal(calls.length, 2);
    assert.equal(h.approvalCalls.length, 6);
    assert.equal(calls[1].args.verifiedTargetId, newTarget.targetId);
  });

  test('never policy also denies target binding before a granting answerer', async t => {
    const calls = captureCore(t);
    const h = harness(t, { policy: 'never', outcome: 'allowed-once' });
    await assert.rejects(h.run('ios_bind_target', BIND), { code: 'approval_denied' });
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('core target binding failures remain failures after adapter authorization', async t => {
    const failure = Object.assign(new Error('bound fingerprint is stale; explicitly rebind'), { code: 'target_binding_stale' });
    const calls = captureCore(t, async () => { throw failure; });
    const h = harness(t);
    await assert.rejects(h.run('ios_read', TARGET), error => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, failure.code);
      assert.equal(error.message, failure.message);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(h.approvalCalls.length, 1);
  });

  test('requires explicit nonempty endpoint and exact operator UDID attestation', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    const noEndpoint = { ...CONNECT };
    delete noEndpoint.endpoint;
    for (const args of [noEndpoint, { ...CONNECT, udid: '' }, { ...CONNECT, verifiedExistingUdid: 'different-device' }, { ...CONNECT, verifiedExistingUdid: '' }]) {
      await assert.rejects(h.run('ios_connect', args), { code: 'device_binding_required' });
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('normalizes only trusted endpoint fallback and never fills the attestation', async t => {
    const calls = captureCore(t);
    const h = harness(t, { config: { endpoint: 'http://127.0.0.1:9444' } });
    const args = { ...CONNECT };
    delete args.endpoint;
    const frozen = Object.freeze(args);
    await h.run('ios_connect', frozen);
    assert.equal(calls[0].args.endpoint, 'http://127.0.0.1:9444');
    assert.equal(Object.hasOwn(frozen, 'endpoint'), false, 'caller input not mutated');
    assert.equal(calls[0].args.verifiedExistingUdid, args.verifiedExistingUdid);
    assert.match(h.approvalCalls[0].reason, /operator-attested/);
    assert.match(h.approvalCalls[0].reason, /not automated proof/);
    await h.run('ios_connect', CONNECT);
    assert.equal(calls[1].args.endpoint, CONNECT.endpoint, 'explicit endpoint wins');
    const withoutAttestation = { ...args };
    delete withoutAttestation.verifiedExistingUdid;
    await assert.rejects(h.run('ios_connect', withoutAttestation), error => error instanceof ToolArgsError);
    assert.equal(h.approvalCalls.length, 2);
  });

  test('missing or malformed owner is denied for both sensitive tools and static capabilities', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    const agents = [undefined, {}, { session: {} }, { session: { id: '' } }, { session: { id: '   ' } }, { session: { id: 42 } }];
    for (const agent of agents) for (const toolName of ['ios_devices', 'ios_capabilities']) {
      await assert.rejects(h.run(toolName, {}, execution({ agent })), { code: 'agent_required' });
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('missing/malformed execution signal and already-aborted calls never authorize or dispatch', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    for (const signal of [undefined, null, {}]) for (const toolName of ['ios_devices', 'ios_capabilities']) {
      await assert.rejects(h.run(toolName, {}, execution({ signal })), { code: 'signal_required' });
    }
    const controller = new AbortController();
    const reason = new Error('already cancelled by caller');
    controller.abort(reason);
    await assert.rejects(h.run('ios_devices', {}, execution({ signal: controller.signal })), error => error === reason);
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  for (const options of [{ policy: 'never' }, { sessionPolicy: 'never' }, { policy: 'unsupported-auto-approve' }]) {
    test('effective non-ask policy denies before a granting answerer: ' + JSON.stringify(options), async t => {
      const calls = captureCore(t);
      const h = harness(t, { ...options, outcome: 'allowed-once' });
      await assert.rejects(h.run('ios_devices'), { code: 'approval_denied' });
      assert.equal(h.approvalCalls.length, 0);
      assert.equal(calls.length, 0);
    });
  }

  test('public session policy override is used instead of deployment default', async t => {
    const calls = captureCore(t);
    const h = harness(t, { policy: 'never', sessionPolicy: 'ask' });
    const exec = execution();
    await h.run('ios_devices', {}, exec);
    assert.equal(h.approvalCalls.length, 1);
    assert.equal(calls.length, 1);
    assert.ok(h.policyQueries.length >= 2);
    assert.ok(h.policyQueries.every(session => session === exec.agent.session));
  });

  for (const outcome of ['rejected', 'unavailable', 'cancelled', 'allowed', true, null, undefined, { approved: true }, { allowed: true }, { outcome: 'allowed-once' }]) {
    test('only bare allowed-once grants; refuses ' + JSON.stringify(outcome), async t => {
      const calls = captureCore(t);
      const h = harness(t, { outcome });
      await assert.rejects(h.run('ios_read', TARGET), { code: 'approval_denied' });
      assert.equal(h.approvalCalls.length, 1);
      assert.equal(calls.length, 0);
    });
  }

  test('absent approval service/request fails closed', async t => {
    const calls = captureCore(t);
    const h = harness(t, { missingApproval: true });
    await assert.rejects(h.run('ios_screenshot', TARGET), { code: 'approval_unavailable' });
    h.ctx.approval = {};
    await assert.rejects(h.run('ios_screenshot', TARGET), { code: 'approval_unavailable' });
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('throwing approval/audit path propagates failure without core dispatch', async t => {
    const calls = captureCore(t);
    const failure = new Error('approval audit or answerer failed');
    const h = harness(t, { request: async () => { throw failure; } });
    await assert.rejects(h.run('ios_read', TARGET), error => error === failure);
    assert.equal(h.approvalCalls.length, 1);
    assert.equal(calls.length, 0);
  });

  test('throwing policy lookup is also fail-closed', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    const failure = new Error('cannot read policy');
    h.approval.overrideOf = () => { throw failure; };
    await assert.rejects(h.run('ios_devices'), error => error === failure);
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  for (const policyKind of ['configured', 'session']) {
    test('policy changing to never while approval is pending denies: ' + policyKind, async t => {
      const calls = captureCore(t);
      const pending = deferred();
      const h = harness(t, { request: () => pending.promise });
      const promise = h.run('ios_screenshot', TARGET);
      assert.equal(h.approvalCalls.length, 1);
      if (policyKind === 'configured') h.approval.config.policy = 'never';
      else h.setSessionPolicy('never');
      pending.resolve('allowed-once');
      await assert.rejects(promise, { code: 'approval_denied' });
      assert.equal(calls.length, 0);
    });
  }

  test('cancellation while approval is pending prevents a late grant dispatch', async t => {
    const calls = captureCore(t);
    const pending = deferred();
    const h = harness(t, { request: () => pending.promise });
    const controller = new AbortController();
    const exec = execution({ signal: controller.signal });
    const promise = h.run('ios_dom_action', { ...TARGET, action: 'click', selector: 'button' }, exec);
    assert.equal(h.approvalCalls[0].signal, controller.signal);
    const reason = new Error('caller cancelled during approval');
    controller.abort(reason);
    pending.resolve('allowed-once');
    await assert.rejects(promise, error => error === reason);
    assert.equal(calls.length, 0);
  });

  test('allowEval is disabled by default and a grant cannot enable it', async t => {
    const calls = captureCore(t);
    const h = harness(t, { outcome: 'allowed-once' });
    await assert.rejects(h.run('ios_eval', { ...TARGET, expression: '1 + 1' }), { code: 'eval_disabled' });
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('extra argument keys cannot spoof identity, executable, paths, scope or authorization', async t => {
    const calls = captureCore(t);
    const h = harness(t, { config: { allowEval: true } });
    const extras = [
      ['ios_devices', {}, 'pythonPath', 'untrusted-python'],
      ['ios_devices', {}, 'headlessAutoApprove', true],
      ['ios_connect', CONNECT, 'autoInstall', true],
      ['ios_connect', CONNECT, 'backend', 'native'],
      ['ios_bind_target', BIND, 'autoBind', true],
      ['ios_bind_target', BIND, 'owner', 'another-session'],
      ['ios_bind_target', BIND, 'title', 'model-supplied-fingerprint'],
      ['ios_bind_target', BIND, 'url', 'model-supplied-fingerprint'],
      ['ios_read', TARGET, 'owner', 'another-session'],
      ['ios_read', TARGET, 'signal', null],
      ['ios_screenshot', TARGET, 'outputPath', 'arbitrary-output.png'],
      ['ios_eval', { ...TARGET, expression: '1 + 1' }, 'allowEval', true],
      ['ios_capabilities', {}, 'connectionId', CONNECTION.connectionId],
    ];
    for (const [toolName, args, key, value] of extras) {
      await assert.rejects(h.run(toolName, { ...args, [key]: value }), error => {
        assert.equal(error.code, 'invalid_arguments');
        assert.match(error.message, /Unknown argument/);
        return true;
      });
    }
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('invalid DOM combinations and numeric bounds fail before approval', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    const invalid = [
      ['ios_acquire', { ...CONNECTION, seconds: 0 }],
      ['ios_acquire', { ...CONNECTION, seconds: 121 }],
      ['ios_read', { ...TARGET, limit: 0 }],
      ['ios_dom_action', { ...TARGET, action: 'click' }],
      ['ios_dom_action', { ...TARGET, action: 'click', selector: ' ' }],
      ['ios_dom_action', { ...TARGET, action: 'click', selector: 'button', value: 'extra' }],
      ['ios_dom_action', { ...TARGET, action: 'input', selector: 'input' }],
      ['ios_dom_action', { ...TARGET, action: 'input', selector: 'input', value: 'plain text', y: 0 }],
      ['ios_dom_action', { ...TARGET, action: 'scroll' }],
      ['ios_dom_action', { ...TARGET, action: 'scroll', y: -1 }],
      ['ios_dom_action', { ...TARGET, action: 'scroll', y: 0, value: 'extra' }],
    ];
    for (const [toolName, args] of invalid) await assert.rejects(h.run(toolName, args), { code: 'invalid_arguments' });
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  test('all eleven sensitive tools require their own real adapter approval and forward exact owner/signal', async t => {
    const calls = captureCore(t);
    const h = harness(t, { config: { allowEval: true } });
    for (const [toolName, action, , valid] of EXPECTED.filter(item => !['capabilities','environment'].includes(item[1]))) {
      const exec = execution({ callId: 'call-for-' + toolName });
      const args = Object.freeze({ ...valid });
      const result = await h.run(toolName, args, exec);
      assert.deepEqual(result, { ok: true, action });
      const call = calls.at(-1);
      const approval = h.approvalCalls.at(-1);
      assert.equal(call.action, action);
      assert.deepEqual(call.args, valid);
      assert.notEqual(call.args, args, 'normalization does not reuse mutable caller object');
      assert.deepEqual(Object.keys(call.exec).sort(), ['owner', 'signal']);
      assert.equal(call.exec.owner, exec.agent.session.id);
      assert.equal(call.exec.signal, exec.signal, 'original live signal reaches core');
      assert.equal(approval.agent, exec.agent);
      assert.equal(approval.toolName, toolName);
      assert.equal(approval.callId, exec.callId);
      assert.equal(approval.signal, exec.signal);
      assert.match(approval.reason, /ONE/);
      assert.match(approval.reason, /not authorization for subsequent/);
      assert.equal(call.service.config.allowEval, true);
    }
    assert.equal(calls.length, 11);
    assert.equal(h.approvalCalls.length, 11);
  });

  test('read, screenshot and input never reuse an earlier grant', async t => {
    const calls = captureCore(t);
    let outcome = 'allowed-once';
    const h = harness(t, { request: async () => outcome });
    const operations = [
      ['ios_read', TARGET], ['ios_screenshot', TARGET],
      ['ios_dom_action', { ...TARGET, action: 'input', selector: 'input', value: 'plain text' }],
    ];
    for (const [toolName, args] of operations) await h.run(toolName, args);
    outcome = 'rejected';
    for (const [toolName, args] of operations) await assert.rejects(h.run(toolName, args), { code: 'approval_denied' });
    assert.equal(h.approvalCalls.length, 6);
    assert.equal(calls.length, 3);
  });

  test('valid programmatic scroll/input are normalized only after approval', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    await h.run('ios_dom_action', { ...TARGET, action: 'scroll', y: 0 });
    await h.run('ios_dom_action', { ...TARGET, action: 'input', selector: 'input', value: '' });
    assert.equal(h.approvalCalls.length, 2);
    assert.equal(calls[0].action, 'dom');
    assert.equal(calls[0].args.action, 'scroll');
    assert.equal(calls[0].args.y, 0);
    assert.equal(calls[1].args.value, '');
  });

  test('core errors become machine-routable HarnessErrors without disguising failure', async t => {
    const failure = Object.assign(new Error('core failed safely'), { code: 'target_changed' });
    const calls = captureCore(t, async () => { throw failure; });
    const h = harness(t);
    await assert.rejects(h.run('ios_screenshot', TARGET), error => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, 'target_changed');
      assert.equal(error.cause, failure);
      assert.match(error.message, /core failed safely/);
      assert.notEqual(error, failure, 'ordinary core errors are wrapped');
      return true;
    });
    assert.equal(h.approvalCalls.length, 1);
    assert.equal(calls.length, 1);
  });

  test('existing HarnessError instances retain class, code, message and identity', async t => {
    const failure = new HarnessError('existing harness failure', 'existing_core_code');
    const calls = captureCore(t, async () => { throw failure; });
    const h = harness(t);
    await assert.rejects(h.run('ios_read', TARGET), error => error === failure);
    assert.equal(calls.length, 1);
    assert.equal(h.approvalCalls.length, 1);
  });

  test('adapter refusals are actual HarnessErrors with preserved machine codes', async t => {
    const calls = captureCore(t);
    const h = harness(t);
    for (const [toolName, args, code] of [
      ['ios_connect', { ...CONNECT, appType: 'native' }, 'unsupported_app_type'],
      ['ios_bind_target', { ...BIND, appIdentity: '' }, 'target_binding_required'],
      ['ios_eval', { ...TARGET, expression: '1' }, 'eval_disabled'],
    ]) {
      await assert.rejects(h.run(toolName, args), error => {
        assert.ok(error instanceof HarnessError);
        assert.equal(error.code, code);
        assert.equal(error.name, 'HarnessError');
        return true;
      });
    }
    assert.equal(calls.length, 0);
    assert.equal(h.approvalCalls.length, 0);
  });

  test('uncoded ordinary core errors receive a stable fallback code and chained cause', async t => {
    const failure = new Error('uncoded core failure');
    const calls = captureCore(t, async () => { throw failure; });
    const h = harness(t);
    await assert.rejects(h.run('ios_read', TARGET), error => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, 'ios_control_error');
      assert.equal(error.message, failure.message);
      assert.equal(error.cause, failure);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  test('unknown mutation outcome is visible without leaking details', async t => {
    const failure = Object.assign(new Error('target command failed'), {
      code: 'target_disconnected',
      details: {
        operationOutcome: 'unknown',
        advice: 'Verify state before retry',
        expression: 'SECRET_EXPRESSION',
        leaseToken: 'SECRET_TOKEN',
      },
    });
    const calls = captureCore(t, async () => { throw failure; });
    const h = harness(t, { config: { allowEval: true } });
    await assert.rejects(h.run('ios_eval', { ...TARGET, expression: 'SECRET_EXPRESSION' }), error => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, 'target_disconnected');
      assert.equal(error.cause, failure);
      assert.match(error.message, /Operation outcome is unknown/);
      assert.match(error.message, /never auto-replay submissions/);
      assert.doesNotMatch(error.message, /SECRET_EXPRESSION|SECRET_TOKEN/);
      return true;
    });
    assert.equal(h.approvalCalls.length, 1);
    assert.equal(calls.length, 1);
  });

  test('capabilities uses the actual static core without approval or transport dispatch', async t => {
    let dispatches = 0;
    let httpCalls = 0;
    t.mock.method(IosControl.prototype, 'dispatch', async () => { dispatches++; throw new Error('no transport allowed'); });
    t.mock.method(globalThis, 'fetch', async () => { httpCalls++; throw new Error('no HTTP allowed'); });
    const h = harness(t, { policy: 'never', request: async () => { throw new Error('no approval expected'); } });
    const value = await h.run('ios_capabilities');
    assert.equal(value.ok, true);
    assert.deepEqual(value.capabilities.platforms, ['ios']);
    assert.deepEqual(value.capabilities.appTypes, ['webview', 'hybrid']);
    for (const key of ['nativeElementTree', 'nativeTap', 'nativeSwipe', 'nativeScreenshot', 'nativeApps', 'flutterApps', 'android']) {
      assert.equal(value.capabilities[key], false, key + ' must not be advertised');
    }
    for (const key of ['devices', 'targets', 'connectionId', 'udid']) assert.equal(Object.hasOwn(value, key), false);
    assert.equal(h.approvalCalls.length, 0);
    assert.equal(h.policyQueries.length, 0);
    assert.equal(dispatches, 0);
    assert.equal(httpCalls, 0);
  });

  test('every registered output renderer emits JSON/text only, including screenshot file metadata', async t => {
    const h = harness(t);
    const value = { ok: true, data: { file: 'evidence.png', metadataFile: 'evidence.png.json', captureKind: 'webview-render', nativeDeviceScreenshot: false } };
    for (const tool of h.registrations) {
      const content = tool.output.render({}, value);
      assert.equal(content.length, 1);
      assert.deepEqual(Object.keys(content[0]).sort(), ['text', 'type']);
      assert.equal(content[0].type, 'text');
      assert.deepEqual(JSON.parse(content[0].text), value);
    }
  });

  test('cleanup is promise-aware, unregisters before core disposal and runs once', async t => {
    const pending = deferred();
    let h;
    const started = deferred();
    let disposals = 0;
    t.mock.method(IosControl.prototype, 'dispose', function () {
      disposals++;
      assert.equal(h.tools.size, 0, 'registrations removed before disposing core');
      assert.ok(h.events.includes('remove-section:tool:ios-webview-app-control'));
      started.resolve();
      return pending.promise;
    });
    h = harness(t);
    let completed = false;
    const cleanup = h.cleanup();
    assert.equal(typeof cleanup.then, 'function');
    cleanup.then(() => { completed = true; });
    try {
      // Observe the actual deferred core start, not a guessed microtask count.
      await started.promise;
      assert.equal(disposals, 1);
      assert.equal(completed, false, 'host must await the core disposal promise');
      assert.equal(h.cleanup(), cleanup, 'cleanup is not duplicated');
    } finally {
      pending.resolve();
      await cleanup;
    }
    assert.equal(completed, true);
    assert.equal(disposals, 1);
    assert.equal(h.events.filter(event => event.startsWith('unregister:')).length, 13);
    assert.equal(h.events.filter(event => event.startsWith('remove-section:')).length, 1);
  });
});
