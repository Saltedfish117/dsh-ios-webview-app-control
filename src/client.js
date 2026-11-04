window.__ModuleLoader__.load({
  id: 'dsh-ios-webview-app-control',
  factory(require) {
    const React = require('react');
    const { z } = require('zod');
    const h = React.createElement;
    const PACKAGE = 'dsh-ios-webview-app-control';
    const NS = 'ios-environment';
    const PHASES = ['unprepared', 'checking', 'downloading', 'creating', 'installing', 'verifying', 'ready', 'failed', 'cancelled'];
    // Own, hand-authored Host-for-Client contribution. No Harness package imports.
    const snapshotSchema = z.strictObject({
      phase: z.enum(PHASES), busy: z.boolean(), step: z.string().max(256),
      progress: z.strictObject({
        completedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      }).nullable().optional(),
      python: z.strictObject({
        path: z.string().max(8192), version: z.string().max(128), source: z.enum(['host', 'private']), abi: z.string().max(128).optional(),
      }).nullable().optional(),
      runtimeDir: z.string().max(8192).optional(), pymobiledevice3: z.string().max(128).optional(),
      error: z.strictObject({ code: z.string().max(128), message: z.string().max(2048) }).nullable().optional(),
    });
    const codec = Object.freeze({
      mode: 'strict', typeSymbol: `${PACKAGE}#EnvironmentSnapshot`,
      create: () => snapshotSchema,
      decode: value => snapshotSchema.parse(value),
      encode: value => snapshotSchema.parse(value),
    });
    const remoteContribution = Object.freeze({
      package: PACKAGE,
      descriptors: Object.freeze(['status', 'prepare', 'cancel', 'cleanup', 'follow'].map(method => Object.freeze({
        id: `${PACKAGE}#iosEnvironment/${method}`, service: 'iosEnvironment', namespace: 'iosEnvironment', method,
        invocation: Object.freeze({ kind: 'direct' }), parameters: Object.freeze([]),
        cancellation: Object.freeze({ parameter: 'signal' }),
        ...(method === 'follow' ? { mode: 'stream' } : {}), result: codec,
      }))),
    });
    const dictionaries = {
      zh: {
        tab: 'iOS 环境', title: 'iOS WebView 环境', activationTitle: '准备 iOS WebView 运行环境',
        intro: '只准备本机 Python 与固定版本依赖；不会发现、配对或连接手机，也不会启动桥接。',
        boundary: '本插件仅提供 iOS WebView / 混合应用控制，不提供原生、Flutter、React Native 或 Android 控制；这不是 DSH 会话的完整工具清单。其它工具需独立核对能力和权限；本插件的设备操作仍逐次审批。',
        loading: '正在读取环境状态…', source: '解释器来源', sourceHost: '宿主 Python', sourcePrivate: '插件私有 Python',
        python: 'Python 版本', path: '解释器路径', abi: 'ABI', runtimeDir: '私有环境目录', dependency: 'pymobiledevice3',
        missing: '尚未准备', phase: '当前阶段', progress: '下载进度', bytes: '{completed} / {total} 字节', bytesUnknown: '已下载 {completed} 字节',
        prepare: '准备环境', retry: '重试准备', cancel: '取消准备', cleanup: '清理闲置环境', refresh: '刷新状态',
        cleanupTitle: '确认清理闲置环境？', cleanupBody: '仅删除本插件管理的未使用旧环境与闲置下载缓存，保留当前活跃环境。不会卸载宿主 Python、删除设备证据或停止外部桥接。',
        cleanupConfirm: '确认清理', back: '保留环境', dismiss: '关闭', details: '查看插件详情',
        failure: '环境操作失败', followFailure: '状态订阅中断，请刷新状态后重试。', ownerRequired: '只有已认证的本机所有者界面可以管理环境；当前请求未获得此权限。',
        step: '步骤', errorCode: '错误代码', working: '正在处理…', readyHint: '本机环境已就绪；这不表示任何设备或 App 已连接、已授权。',
        firstUseTitle: '首次连接检查清单',
        firstUseIntro: '软件就绪不等于手机或 App 就绪。以下项目需人为检查；本面板不会访问设备、自动配对或启动桥接。清单会保留在插件设置页。',
        firstUsePreflight: '先请 Agent 调用 ios_preflight，明确指定 workflow=device-discovery（设备发现）或 workflow=existing-bridge（已有桥接）。它只检查本机私有软件环境并返回人工清单，不访问设备、不自动准备环境，也不授予设备操作权限。已有桥接流程不依赖此 Python 环境就绪。',
        firstUseUsb: '使用支持数据传输的数据线连接电脑，解锁 iPhone / iPad，并由你在设备上处理“信任此电脑”和必要确认；不要让 Agent 自动信任或配对。',
        firstUseInspector: '网页检查器：新系统在“设置 → App → Safari → 高级 → 网页检查器”，旧系统在“设置 → Safari → 高级 → 网页检查器”；由你按设备实际界面开启。',
        firstUseDeveloperMode: 'Developer Mode（开发者模式）仅在开发签名、调试或当前工具链明确要求时按需开启；不是所有 WebView / 已有桥接流程都需要。',
        firstUseApp: '请 App 开发者确认当前版本允许 WebView 检查；网页检查器开关不能替代 App 侧支持。目标列表为空可能有多种原因，不能据此断定开关已关闭。',
        firstUseBridge: '只使用已存在的本机 loopback bridge。由你选定精确 UDID，并明确确认该桥属于这台设备；连接成功不证明桥归属。不要让 Agent 新建或启动桥接。',
        firstUseRecheck: '人工检查后，请 Agent 按所选流程复检：设备发现使用 ios_devices；已有桥接从 ios_connect → ios_targets 开始，人工确认精确 target id、受支持的 App 类型与 App 身份后，再 ios_bind_target → ios_acquire。每次设备调用均需单独的一次性审批，未获审批不得执行或绕过；新目标或导航后需重新列出并显式绑定。',
        'phase.unprepared': '未准备', 'phase.checking': '检查宿主解释器', 'phase.downloading': '下载 Python / 依赖',
        'phase.creating': '创建私有环境', 'phase.installing': '安装固定依赖', 'phase.verifying': '验证环境',
        'phase.ready': '就绪', 'phase.failed': '准备失败', 'phase.cancelled': '已取消',
      },
      en: {
        tab: 'iOS environment', title: 'iOS WebView environment', activationTitle: 'Prepare the iOS WebView environment',
        intro: 'Prepares local Python and pinned dependencies only. Does not discover, pair, or connect to a phone, or start a bridge.',
        boundary: 'This plugin provides iOS WebView / hybrid control only, not native, Flutter, React Native or Android control. This is not a DSH/session tool inventory. Inspect independent tools and their permissions separately; device operations in this plugin still require individual approval.',
        loading: 'Reading environment status…', source: 'Interpreter source', sourceHost: 'Host Python', sourcePrivate: 'Plugin-private Python',
        python: 'Python version', path: 'Interpreter path', abi: 'ABI', runtimeDir: 'Private environment directory', dependency: 'pymobiledevice3',
        missing: 'Not prepared', phase: 'Current phase', progress: 'Download progress', bytes: '{completed} / {total} bytes', bytesUnknown: '{completed} bytes downloaded',
        prepare: 'Prepare environment', retry: 'Retry preparation', cancel: 'Cancel preparation', cleanup: 'Clean up unused environments', refresh: 'Refresh status',
        cleanupTitle: 'Clean up unused environments?', cleanupBody: 'Deletes only unused old environments and idle download caches managed by this plugin, retaining the active environment. Does not uninstall host Python, remove device evidence, or stop an external bridge.',
        cleanupConfirm: 'Confirm cleanup', back: 'Keep environment', dismiss: 'Close', details: 'Plugin details',
        failure: 'Environment operation failed', followFailure: 'Status subscription ended. Refresh the status and retry.', ownerRequired: 'Only an authenticated owner UI can manage this environment. This request has no such authority.',
        step: 'Step', errorCode: 'Error code', working: 'Working…', readyHint: 'The local environment is ready. No device or app is connected or authorized by this state.',
        firstUseTitle: 'First connection checklist',
        firstUseIntro: 'Software readiness does not mean your phone or app is ready. Check the following manually; this panel does not access devices, pair automatically, or start a bridge. The checklist remains available in plugin settings.',
        firstUsePreflight: 'Ask the Agent to call ios_preflight first, explicitly choosing workflow=device-discovery or workflow=existing-bridge. It only checks the local private software environment and returns a manual checklist; it does not access devices, prepare the environment automatically, or authorize device operations. An existing bridge does not require this Python environment to be ready.',
        firstUseUsb: 'Connect a data-capable cable to the computer, unlock your iPhone / iPad, and handle “Trust This Computer” and any necessary confirmations yourself on the device. Do not ask the Agent to trust or pair automatically.',
        firstUseInspector: 'Web Inspector: use Settings → Apps → Safari → Advanced → Web Inspector on newer systems, or Settings → Safari → Advanced → Web Inspector on older systems. Enable it yourself using the path available on your device.',
        firstUseDeveloperMode: 'Enable Developer Mode only when development signing, debugging, or your current toolchain explicitly requires it. Not every WebView / existing-bridge workflow needs it.',
        firstUseApp: 'Ask the app developer to confirm that this app version allows WebView inspection; the Web Inspector switch cannot replace app-side support. An empty target list can have multiple causes and does not prove that the switch is off.',
        firstUseBridge: 'Use an existing local loopback bridge only. Select the exact UDID yourself and explicitly confirm that the bridge belongs to that device; a successful connection does not prove bridge ownership. Do not ask the Agent to create or start a bridge.',
        firstUseRecheck: 'After the manual checks, ask the Agent to recheck your workflow: use ios_devices for discovery; for an existing bridge, start with ios_connect → ios_targets, then confirm the exact target id, supported app type, and app identity yourself before ios_bind_target → ios_acquire. Every device call requires separate one-shot approval; without it, do not execute or bypass the call. Relist and explicitly rebind after a new target or navigation.',
        'phase.unprepared': 'Not prepared', 'phase.checking': 'Checking host interpreter', 'phase.downloading': 'Downloading Python / dependencies',
        'phase.creating': 'Creating private environment', 'phase.installing': 'Installing pinned dependencies', 'phase.verifying': 'Verifying environment',
        'phase.ready': 'Ready', 'phase.failed': 'Preparation failed', 'phase.cancelled': 'Cancelled',
      },
    };
    // Native settings row spacing / typography; only Host light/dark tokens.
    const css = `
.iosenv-root{max-width:760px;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:12px}
.iosenv-root h3{font-size:16px;line-height:24px;font-weight:600;margin:0}.iosenv-root p{margin:0}.iosenv-muted{color:var(--dsw-alias-label-secondary)}
.iosenv-state{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.iosenv-statehead{display:flex;align-items:center;justify-content:space-between;gap:12px}.iosenv-phase{font-size:14px;font-weight:500}.iosenv-rows{margin:0;display:flex;flex-direction:column}
.iosenv-row{display:grid;grid-template-columns:minmax(100px,150px) minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.iosenv-row dt{color:var(--dsw-alias-label-secondary)}.iosenv-row dd{margin:0;overflow-wrap:anywhere}.iosenv-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.iosenv-actions{display:flex;flex-wrap:wrap;gap:8px}.iosenv-button{font:inherit;font-size:13px;line-height:20px;min-height:32px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.iosenv-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.iosenv-button:disabled{cursor:not-allowed;opacity:.45}.iosenv-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.iosenv-primary{color:var(--dsw-alias-brand-primary);font-weight:500}.iosenv-error{border-left:3px solid var(--dsw-alias-state-error-primary);padding:8px 12px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}
.iosenv-confirm{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}.iosenv-progress{width:100%;height:6px;accent-color:var(--dsw-alias-brand-primary)}
.iosenv-boundary{padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2)}
.iosenv-firstuse{display:flex;flex-direction:column;gap:8px}.iosenv-firstuse h4{font-size:14px;line-height:20px;font-weight:500;margin:0}.iosenv-checklist{margin:0;padding-inline-start:20px}.iosenv-checklist li+li{margin-top:8px}
@media(max-width:520px){.iosenv-row{grid-template-columns:1fr;gap:3px}}
`;
    const messageOf = (error, t) => error?.code === 'ios-environment/owner-required'
      ? t('ownerRequired')
      : typeof error?.message === 'string' ? error.message.slice(0, 2048) : t('failure');

    async function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'iosEnvironment dictionaries');
      // Await concrete namespace installation before either slot is registered.
      await ctx.remote.$mount(remoteContribution);
      // $mount creates the traced namespace Service dynamically. Read it through
      // the public optional-service accessor; it cannot be a static inject before mount.
      const environment = ctx.get('remote.iosEnvironment');
      if (!environment) throw new Error('iosEnvironment Remote namespace did not mount.');
      const subscribeLocale = listener => ctx.locale.subscribe(listener);
      const localeSnapshot = () => ctx.locale.getSnapshot();
      function EnvironmentPanel(props) {
        React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
        const [snapshot, setSnapshot] = React.useState(null);
        const [error, setError] = React.useState(null);
        const [working, setWorking] = React.useState(false);
        const [confirmCleanup, setConfirmCleanup] = React.useState(false);
        const [revision, setRevision] = React.useState(0);
        const live = React.useRef(null);
        const confirmedButton = React.useRef(null);
        const dismissed = React.useRef(false);
        const panelId = React.useId();
        React.useEffect(() => {
          const control = new AbortController();
          live.current = control;
          let stream;
          let active = true;
          (async () => {
            try {
              stream = environment.follow(control.signal);
              for await (const value of stream) {
                if (!active) return;
                setSnapshot(snapshotSchema.parse(value));
                setError(null);
              }
              if (active && !control.signal.aborted) setError({ message: t('followFailure') });
            } catch (failure) {
              if (active && !control.signal.aborted) setError(failure);
            }
          })();
          return () => {
            active = false;
            control.abort();
            stream?.dispose();
            if (live.current === control) live.current = null;
          };
        }, [revision]);
        React.useEffect(() => { if (confirmCleanup) confirmedButton.current?.focus(); }, [confirmCleanup]);
        // Activation guidance exists to get the environment ready, so it closes
        // itself once preparation settles in a state that needs no action.
        const settledReady = snapshot !== null && snapshot.phase === 'ready' && snapshot.busy !== true;
        React.useEffect(() => {
          if (!props.activation || !settledReady || dismissed.current) return;
          dismissed.current = true;
          if (typeof props.onDismiss === 'function') props.onDismiss();
        }, [props.activation, settledReady, props.onDismiss]);
        async function run(action) {
          const control = live.current;
          if (!control || control.signal.aborted || (working && !(action === 'cancel' && working === 'prepare'))) return;
          setWorking(action);
          setError(null);
          try {
            const result = await environment[action](control.signal);
            if (control.signal.aborted) return;
            if (!result.ok) { setError(result.error); return; }
            setSnapshot(snapshotSchema.parse(result.value));
          } catch (failure) {
            if (!control.signal.aborted) setError(failure);
          } finally {
            if (!control.signal.aborted) setWorking(false);
          }
        }
        function button(label, action, disabled, extra = {}) {
          return h('button', { type: 'button', className: 'iosenv-button', disabled: Boolean(disabled), onClick: action, ...extra }, label);
        }
        function row(label, value, mono = false) {
          return h('div', { className: 'iosenv-row', key: label }, h('dt', null, label), h('dd', { className: mono ? 'iosenv-mono' : undefined }, value || t('missing')));
        }
        const busy = snapshot?.busy === true;
        // Step and byte counts describe an in-flight preparation only; once it
        // settles they must not read like a stalled download.
        const progress = busy ? snapshot?.progress : null;
        const step = busy ? snapshot?.step : null;
        const total = progress?.totalBytes;
        const progressText = progress ? t(total === undefined ? 'bytesUnknown' : 'bytes', { completed: progress.completedBytes, total }) : null;
        const phase = snapshot?.phase;
        const rows = snapshot ? [
          row(t('source'), snapshot.python ? t(snapshot.python.source === 'host' ? 'sourceHost' : 'sourcePrivate') : null),
          row(t('python'), snapshot.python?.version), row(t('path'), snapshot.python?.path, true),
          ...(snapshot.python?.abi ? [row(t('abi'), snapshot.python.abi, true)] : []),
          ...(snapshot.runtimeDir ? [row(t('runtimeDir'), snapshot.runtimeDir, true)] : []),
          row(t('dependency'), snapshot.pymobiledevice3),
        ] : [];
        return h('section', { className: 'iosenv-root', 'aria-labelledby': `${panelId}-title` },
          h('style', null, css),
          h('h3', { id: `${panelId}-title` }, t(props.activation ? 'activationTitle' : 'title')),
          h('p', { className: 'iosenv-muted' }, t('intro')),
          h('div', { className: 'iosenv-state', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'iosenv-statehead' }, h('span', null, t('phase')), h('strong', { className: 'iosenv-phase' }, snapshot ? t(`phase.${phase}`) : t('loading'))),
            step ? h('p', { className: 'iosenv-muted' }, `${t('step')}: ${step}`) : null,
            progressText ? h('p', null, progressText) : null,
            progress ? h('progress', { className: 'iosenv-progress', 'aria-label': t('progress'), ...(total > 0 ? { max: total, value: Math.min(progress.completedBytes, total) } : {}) }) : null,
            phase === 'ready' ? h('p', { className: 'iosenv-muted' }, t('readyHint')) : null),
          snapshot ? h('dl', { className: 'iosenv-rows' }, ...rows) : null,
          snapshot?.error ? h('div', { className: 'iosenv-error', role: 'alert' }, h('p', null, snapshot.error.message), h('p', { className: 'iosenv-muted' }, `${t('errorCode')}: ${snapshot.error.code}`)) : null,
          error ? h('div', { className: 'iosenv-error', role: 'alert' }, messageOf(error, t)) : null,
          h('div', { className: 'iosenv-actions' },
            button(t(phase === 'failed' || phase === 'cancelled' ? 'retry' : 'prepare'), () => run('prepare'), working || busy || !snapshot, { className: 'iosenv-button iosenv-primary' }),
            button(t('cancel'), () => run('cancel'), !busy || (working && working !== 'prepare')),
            button(t('cleanup'), () => setConfirmCleanup(true), working || busy || !snapshot),
            button(t('refresh'), () => { setWorking(false); setRevision(value => value + 1); }, working)),
          working ? h('p', { className: 'iosenv-muted', role: 'status' }, t('working')) : null,
          confirmCleanup ? h('div', { className: 'iosenv-confirm', role: 'alertdialog', 'aria-labelledby': `${panelId}-confirm`, 'aria-describedby': `${panelId}-cleanup`, onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); setConfirmCleanup(false); } } },
            h('strong', { id: `${panelId}-confirm` }, t('cleanupTitle')),
            h('p', { id: `${panelId}-cleanup`, className: 'iosenv-muted' }, t('cleanupBody')),
            h('div', { className: 'iosenv-actions' },
              button(t('back'), () => setConfirmCleanup(false), false, { ref: confirmedButton }),
              button(t('cleanupConfirm'), () => { setConfirmCleanup(false); run('cleanup'); }, working || busy))) : null,
          h('section', { className: 'iosenv-firstuse iosenv-boundary', 'aria-labelledby': `${panelId}-first-use` },
            h('h4', { id: `${panelId}-first-use` }, t('firstUseTitle')),
            h('p', { className: 'iosenv-muted' }, t('firstUseIntro')),
            h('ol', { className: 'iosenv-checklist' },
              ...['firstUsePreflight', 'firstUseUsb', 'firstUseInspector', 'firstUseDeveloperMode', 'firstUseApp', 'firstUseBridge', 'firstUseRecheck']
                .map(key => h('li', { key }, t(key))))),
          h('p', { className: 'iosenv-muted iosenv-boundary' }, t('boundary')),
          props.activation ? h('div', { className: 'iosenv-actions' },
            button(t('details'), props.onOpenDetails, false), button(t('dismiss'), props.onDismiss, false)) : null);
      }
      ctx.effect(() => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'ios-environment', order: 80,
        label: () => t('tab'),
      }, EnvironmentPanel)), 'iosEnvironment settings tab');
      ctx.effect(() => ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({
        name: 'plugins.bundle.activation', key: PACKAGE,
      }, props => h(EnvironmentPanel, { ...props, activation: true }))), 'iosEnvironment activation panel');
    }
    return { inject: ['slots', 'locale', 'remote'], apply };
  },
});
