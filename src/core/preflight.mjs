// Diagnostic observations only. Nothing in this module performs device I/O,
// grants authority, or infers app identity from device-wide discovery metadata.
export const PREFLIGHT_WORKFLOWS = Object.freeze(['device-discovery', 'existing-bridge']);
export const CHECK_STATUSES = Object.freeze(['passed', 'failed', 'unknown', 'not_checked', 'not_applicable']);

const check = (id, status, evidence, message) => ({ id, status, evidence, message });
const manual = (id, message) => ({ id, kind: 'manual', tool: null, requiresApproval: false, message });
const tool = (id, name, message, requiresApproval = true) => ({ id, kind: 'tool', tool: name, requiresApproval, message });

function phoneChecks() {
  return [
    check('usb_trust', 'unknown', 'not-directly-observed', '未直接验证所选手机的数据连接、解锁、信任或配对状态；发现设备不等于这些条件均已满足。'),
    check('web_inspector', 'unknown', 'not-directly-observed', '未读取手机网页检查器开关；空目标列表不能证明该开关关闭。'),
    check('developer_mode', 'unknown', 'workflow-dependent', '未检测开发者模式；是否需要取决于设备和调试流程，不能一律要求开启。'),
    check('app_inspectability', 'unknown', 'not-directly-observed', '未证明目标 App 允许 WebView 检查；有可检查页面也不能推断整个 App 的技术类型或身份。'),
    check('device_binding', 'unknown', 'operator-confirmation-required', 'bridge 与所选 UDID 的对应关系仍需操作者明确确认，连通性不是自动证明。'),
    check('app_identity', 'unknown', 'operator-confirmation-required', 'exact target 的 App 身份和 webview/hybrid 类型需操作者确认，不能从标题或 URL 推断。'),
    check('device_authorization', 'not_checked', 'fresh-approval-required', '预检不授予设备访问权限；设备发现、连接、列目标及后续操作分别需要新的一次性审批。'),
  ];
}

function phoneActions() {
  return [
    manual('check_usb_trust', '使用可传数据的 USB 线，解锁手机；若出现“信任此电脑”，由用户自行确认。不要自动配对、输入密码或操作系统弹窗。'),
    manual('enable_web_inspector', '请用户确认网页检查器：较新 iOS 为“设置 → App → Safari → 高级 → 网页检查器”，较旧版本为“设置 → Safari → 高级 → 网页检查器”；菜单名称可能随系统版本不同。'),
    manual('developer_mode_if_needed', '只有当前设备/调试流程明确要求时，再由用户到“设置 → 隐私与安全性 → 开发者模式”处理，并按系统提示重启确认；没有该项或要求不明确时保持待确认，不一律要求开启。'),
    manual('open_inspectable_app', '在手机上打开目标 App 页面，并请开发者确认该 WebView 允许检查；若 App 未开放检查，单改手机设置无法解决。'),
    manual('confirm_existing_bridge', '请操作者提供已经运行的 loopback bridge 地址、准确 UDID，并明确确认二者对应关系。本插件不启动、替换或停止外部 bridge。'),
  ];
}

/** Each report is fresh, bounded, and contains fixed instructions, never page text. */
export function preflightReport({ stage = 'local', workflow = 'device-discovery', runtime = 'unknown', deviceCount = 0, pageCount = 0, runtimeCode = null } = {}) {
  if (!PREFLIGHT_WORKFLOWS.includes(workflow)) throw new TypeError('Unknown preflight workflow.');
  if (!['local', 'devices', 'connect', 'targets'].includes(stage)) throw new TypeError('Unknown preflight stage.');
  if (!CHECK_STATUSES.includes(runtime)) throw new TypeError('Unknown runtime check status.');
  if (![deviceCount, pageCount].every(value => Number.isSafeInteger(value) && value >= 0)) throw new TypeError('Invalid discovery count.');
  const existing = workflow === 'existing-bridge';
  const unsupportedRuntime = !existing && runtimeCode === 'unsupported_platform';
  const checks = [check('software_runtime', existing ? 'not_applicable' : runtime,
    existing ? 'existing-bridge-does-not-use-python' : runtime === 'passed' ? 'local-runtime-verified' : 'local-runtime-not-verified',
    existing ? '连接已有 bridge 不依赖本机 Python；不要求先 prepare。' : unsupportedRuntime ? '当前插件私有 Python 后端只支持 Windows x64；在此平台反复 prepare 无法修复。已有 bridge 的连接流程不依赖本机 Python。' : runtime === 'passed' ? '本次已验证本地 Python 后端可用；不代表手机、App 或设备授权已就绪。' : '本地软件环境尚未通过本次验证；请查看环境状态，必要时显式准备后复检。'),
    ...phoneChecks()];
  const actions = [];
  if (stage === 'local') {
    checks.push(check('device_discovery', 'not_checked', 'no-device-io', '本次未发现或读取设备。'),
      check('bridge_endpoint', 'not_checked', 'no-device-io', '本次未访问 bridge。'),
      check('page_targets', 'not_checked', 'no-device-io', '本次未列出目标页面。'));
    if (!existing && runtime !== 'passed') {
      actions.push(tool('inspect_environment', 'ios_environment', '调用 ios_environment(action=status) 查看状态；准备中的环境先等待，不要反复重试。', false));
      if (unsupportedRuntime) actions.push(manual('unsupported_runtime', '当前私有设备发现后端不支持此电脑平台；不要反复 prepare。若操作者已提供合格的已有 bridge，可改选 existing-bridge 做纯本地预检，但后续设备访问仍需原有资格确认与逐次审批。'));
      else actions.push(manual('prepare_environment', '未就绪或准备失败时，确认原因后调用 ios_environment(action=prepare)，沿用原有 Full access/一次性授权规则；完成后重新运行 ios_preflight。'));
    }
    actions.push(...phoneActions());
    actions.push(existing
      ? tool('connect_existing_bridge', 'ios_connect', '仅在操作者确认支持的 App 类型、UDID 和已有 bridge 归属后，另行审批 ios_connect；成功后再单独审批 ios_targets。')
      : tool('discover_devices', 'ios_devices', '软件可用且获得本次审批后调用 ios_devices；用户选择准确 UDID，不从列表自动代选。'));
  } else if (stage === 'devices') {
    checks.push(check('device_discovery', deviceCount > 0 ? 'passed' : 'failed', deviceCount > 0 ? 'devices-returned' : 'empty-device-list',
      deviceCount > 0 ? '本次后端返回设备；仅证明发现结果，不证明所选设备信任、App 可检查或已授权后续操作。' : '本次未发现设备；不能据此断言未信任、未开启检查器或驱动缺失。'),
      check('bridge_endpoint', 'not_checked', 'not-requested', '本次未检查已有 bridge。'),
      check('page_targets', 'not_checked', 'not-requested', '本次未列出目标页面。'));
    if (deviceCount === 0) actions.push(...phoneActions().slice(0, 1), manual('check_apple_service', '检查数据线、USB 端口和本机 Apple 设备支持服务；不要自动安装驱动或修改系统服务。'),
      tool('retry_device_discovery', 'ios_devices', '用户处理后，经新的一次性审批重新发现设备；不自动轮询或重放。'));
    else actions.push(manual('select_device', '请用户从发现结果中明确选择准确 UDID；不要从名称、列表顺序或另一会话自动填入确认。'),
      ...phoneActions(), tool('connect_existing_bridge', 'ios_connect', '已有 bridge 与 UDID 经人工确认后，单独审批连接；本次发现许可不能复用。'));
  } else {
    checks.push(check('device_discovery', 'not_applicable', 'existing-bridge-workflow', '已有 bridge 流程未执行 USB 设备发现。'),
      check('bridge_endpoint', 'passed', 'bridge-response-received', '本次已访问已有 bridge；不证明它对应哪个 UDID。'),
      check('page_targets', pageCount > 0 ? 'passed' : 'failed', pageCount > 0 ? 'page-metadata-returned' : 'no-page-targets',
        pageCount > 0 ? 'bridge 列出了 page 类型目标；这不是目标 App 身份、前台状态或可读 DOM 的证明。' : 'bridge 可访问，但没有 page 类型目标；不能把空列表或仅 JSContext/Node 目标认定为网页检查器关闭。'));
    if (pageCount === 0) actions.push(...phoneActions().slice(0, 4),
      tool('retry_target_listing', 'ios_targets', '用户完成设置或打开页面后，另行审批 ios_targets 复检；不要自动切换目标或启动第二个 bridge。'));
    else actions.push(manual('confirm_exact_target', '请用户明确确认 exact targetId 对应的 App 身份以及支持的 webview/hybrid 类型；不能从元数据自动推断。'),
      tool('bind_exact_target', 'ios_bind_target', '重新列出目标并获得操作者确认后，单独审批绑定 exact target；绑定不授予读取权限，后续租约及操作继续逐次审批。'));
  }
  if (runtimeCode) {
    // Codes are metadata only; never echo arbitrary backend messages or details.
    const known = ['environment_not_ready', 'unsupported_platform', 'python_missing'];
    checks[0].evidence = known.includes(runtimeCode) ? runtimeCode : 'local-runtime-verification-failed';
  }
  return { schemaVersion: 1, source: 'dsh-ios-webview-app-control', scope: 'plugin-only', stage, workflow,
    deviceAccessPerformed: stage !== 'local', authorizationGranted: false, checks, nextActions: actions };
}

/** Only allowlisted fixed recovery instructions may cross the tool error boundary. */
export function recoveryMessage(code, action) {
  const normalized = typeof code === 'string' ? (code.startsWith('ios-environment/') ? code.slice('ios-environment/'.length) : code) : '';
  if (['approval_denied', 'approval_unavailable', 'cancelled', 'service_disposed'].includes(normalized)) return '';
  if (normalized === 'environment_not_ready' || normalized.startsWith('runtime_') || normalized === 'environment_failed' || normalized === 'environment_busy') {
    return '下一步：调用 ios_environment(action=status) 查看本机环境；准备中先等待，失败时修复原因后显式 prepare，再运行 ios_preflight。不要在设备调用中隐式安装；连接已有 bridge 不需要先准备 Python。';
  }
  if (action === 'devices' && ['python_error', 'python_missing', 'process_error', 'process_timeout', 'output_limit', 'invalid_device_list', 'operation_failed'].includes(normalized)) {
    return '下一步：先用 ios_preflight(workflow=device-discovery) 核对软件，再请用户检查数据线、手机解锁、人工信任和 Apple 设备支持服务；这不是具体开关故障诊断。用户处理后另行审批 ios_devices 复检，不自动配对。';
  }
  if (['connect', 'targets', 'bind'].includes(action) && ['wrong_bridge', 'bridge_http_error', 'invalid_bridge', 'operation_failed', 'target_not_found', 'result_too_large'].includes(normalized)) {
    return '下一步：请操作者确认已有 loopback bridge 正常且对应所选 UDID；不要自动启动或替换 bridge。找不到页面时请用户检查手机解锁、打开 App 页面、网页检查器及 App 是否允许检查；空列表不能证明检查器关闭，Developer Mode 仅在流程明确需要时处理。修复后按原顺序重新请求单次审批复检。';
  }
  return '';
}
