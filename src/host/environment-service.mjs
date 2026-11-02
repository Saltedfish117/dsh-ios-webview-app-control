import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { environmentHostContribution, projectEnvironmentSnapshot } from '../typert-environment.mjs';

const ACTIONS = new Set(['status', 'prepare', 'cancel', 'cleanup']);
const MANAGER_METHODS = ['status', 'subscribe', 'prepare', 'cancel', 'cleanup'];

function failure(code, message) {
  return new RemoteError(`ios-environment/${code}`, message, {});
}

function assertSignal(signal) {
  if (signal !== undefined && (!(signal instanceof AbortSignal))) {
    throw failure('invalid-signal', 'Environment operations require an AbortSignal supplied by the Host.');
  }
  signal?.throwIfAborted();
}

/**
 * Shared, Host-only operation controller. The parent plugin owns manager.dispose().
 * The agent tool must perform its DSH sandbox/one-shot-approval gate BEFORE execute.
 * No caller-supplied authority, Python path, download URL or device id is accepted.
 */
export function createIosEnvironmentController(manager) {
  for (const key of MANAGER_METHODS) {
    if (typeof manager?.[key] !== 'function') throw new TypeError(`EnvironmentManager.${key} is required.`);
  }
  const lifetime = new AbortController();
  const active = new Set();
  const followers = new Set();
  let disposed = false;
  let disposal;
  const check = signal => {
    if (disposed) throw failure('disposed', 'The environment service has been unloaded.');
    assertSignal(signal);
  };
  const snapshot = () => {
    try { return projectEnvironmentSnapshot(manager.status()); }
    catch { throw failure('invalid-status', 'The environment manager returned an invalid public status.'); }
  };
  async function execute(action, options = {}) {
    if (!ACTIONS.has(action)) throw failure('invalid-action', 'Unknown environment action.');
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || Reflect.ownKeys(options).some(key => key !== 'signal')) {
      throw failure('invalid-options', 'Environment options accept only the Host execution signal.');
    }
    check(options.signal);
    const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
    if (action === 'status') return snapshot();
    const work = (async () => {
      signal.throwIfAborted();
      try {
        if (action === 'prepare') await manager.prepare({ signal });
        else if (action === 'cancel') await manager.cancel();
        else await manager.cleanup({ signal });
      } catch (error) {
        signal.throwIfAborted();
        // EnvironmentManager publishes safe structured failures. Do not leak
        // subprocess stderr, environment variables, or arbitrary Error details.
        const state = snapshot();
        throw failure(state.error?.code ?? 'operation-failed', state.error?.message ?? 'Environment operation failed. See its status and retry explicitly.');
      }
      signal.throwIfAborted();
      return snapshot();
    })();
    active.add(work);
    try { return await work; }
    finally { active.delete(work); }
  }
  function follow(callerSignal) {
    check(callerSignal);
    let closed = false;
    let pending;
    let wake;
    let off;
    const signal = callerSignal ? AbortSignal.any([lifetime.signal, callerSignal]) : lifetime.signal;
    const touch = () => {
      if (closed) return;
      // Coalesce updates: a slow UI retains one latest snapshot, not a log.
      pending = true;
      wake?.();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      off?.();
      signal.removeEventListener('abort', close);
      followers.delete(close);
      wake?.();
    };
    followers.add(close);
    try {
      off = manager.subscribe(touch);
      if (typeof off !== 'function') throw new TypeError('EnvironmentManager.subscribe must return an unsubscribe function.');
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) close();
      else touch(); // Subscribe before the opening baseline; status grants nothing.
    } catch (error) {
      close();
      throw error;
    }
    const iterator = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        while (!closed && !pending) await new Promise(resolve => { wake = resolve; });
        wake = undefined;
        if (closed) return { done: true, value: undefined };
        pending = false;
        try { return { done: false, value: snapshot() }; }
        catch (error) { close(); throw error; }
      },
      return() { close(); return Promise.resolve({ done: true, value: undefined }); },
    };
    return iterator;
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    lifetime.abort();
    for (const close of [...followers]) close();
    disposal = Promise.allSettled([...active]).then(() => undefined);
    return disposal;
  }
  return Object.freeze({ execute, follow, dispose });
}

function ownerInvocation(service, signal) {
  const invocation = service.ctx.invocation;
  const peer = invocation?.peer;
  // Gateway-owned invocation identity is independent of status read access.
  // A missing invocation, passive non-owner or disposed Peer never gains a write.
  if (invocation?.service !== 'iosEnvironment'
    || invocation?.request?.namespace !== 'iosEnvironment'
    || peer?.principal?.kind !== 'owner'
    || !(peer.signal instanceof AbortSignal)
    || peer.signal.aborted) {
    throw failure('owner-required', 'Only an authenticated owner UI may manage the local environment.');
  }
  assertSignal(signal);
}

/** Remote wrappers have no wire business parameters and all require owner Peer. */
export class IosEnvironmentService extends TypertRemoteService {
  constructor(ctx, controller) {
    super(ctx, 'iosEnvironment');
    this.controller = controller;
  }
  status(signal) { ownerInvocation(this, signal); return this.controller.execute('status', { signal }); }
  prepare(signal) { ownerInvocation(this, signal); return this.controller.execute('prepare', { signal }); }
  cancel(signal) { ownerInvocation(this, signal); return this.controller.execute('cancel', { signal }); }
  cleanup(signal) { ownerInvocation(this, signal); return this.controller.execute('cleanup', { signal }); }
  follow(signal) { ownerInvocation(this, signal); return this.controller.follow(signal); }
  /** Host only: intentionally absent from every Remote descriptor/marker. */
  execute(action, options) {
    if (this.ctx.invocation !== undefined) throw failure('host-only', 'Host environment execution is not a Remote endpoint.');
    return this.controller.execute(action, options);
  }
}

/**
 * Register on the parent's owning Cordis context; never starts preparation.
 * Parent creates/owns EnvironmentManager and calls this only when typert exists.
 * @returns {{service: IosEnvironmentService, controller: object, dispose: Function}}
 */
export function registerIosEnvironment(ctx, { manager, controller = createIosEnvironmentController(manager) } = {}) {
  const typert = ctx?.get?.('typert');
  if (typeof typert?.register !== 'function') throw new TypeError('The typert registry is required.');
  let service;
  const dispose = ctx.effect(function* () {
    // Reverse disposal removes strict endpoints before ending followers.
    yield () => controller.dispose();
    service = new IosEnvironmentService(ctx, controller);
    yield typert.register(environmentHostContribution);
  }, 'iosEnvironment strict service registrations');
  return { service, controller, dispose };
}
