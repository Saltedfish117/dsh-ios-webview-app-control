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
