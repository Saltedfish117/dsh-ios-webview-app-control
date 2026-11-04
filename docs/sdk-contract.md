# DSH SDK 兼容合同

## 兼容基线

下表保留插件 **0.2.1** 的已验证快照；分层预检一节描述当前源码合同，不表示该变更已经发布、安装或通过真机验收。插件声明的兼容范围以 [package.json](<../package.json>) 的 `engines.dsh` 与 `peerDependencies` 为准；范围内版本需按本文合同使用，范围外不作兼容承诺。

0.1.0 曾精确要求 rc.3 的 tools/system-prompt/user-approval/llm，在 rc.5 运行时被 `incompatible-version` 拒绝，不会创建 Loader 行。0.2.x 改用 `^0.2.1-rc.5` 的 peer 范围，没有拿版本豁免绕过检查。

| 项目 | 声明范围 | 已验证版本（快照） |
| --- | --- | --- |
| Node | `>=22.18.0` | 22.18.0 |
| `engines.dsh` | `>=0.2.1-rc.5 <0.3.0` | 0.2.1-rc.5 |
| 四项 DSH peer | `^0.2.1-rc.5` | 0.2.1-rc.5 |
| Cordis | `~4.0.5` | 4.0.5 |
| Schemastery | `~3.18.5` | 3.18.5 |

版本范围是安装约束，不等于所有版本已测试。未验证 alpha、未来 0.3 或其它 SDK；更新范围前应重新查询 Service 合同、读取目标版本说明并运行集成测试。

## Host 适配合同

[插件入口](../src/plugin.mjs) 注册 Host 工具，并提供环境管理 Client 界面。使用具名 `name`、`inject`、`Config`、`apply` 导出，依赖 `tools`、`approval`、`systemPrompt`。这些入口已经按 SDK 说明和运行时 Inspect 核对过，快照见文末。

1. `ctx.tools.register(defineTool({...}))` 注册 14 个工具（新增 `ios_preflight`），系统提示词自动获得可见工具 schema。`defineTool.parameters` 是每个参数带 `required: true` 的属性映射，不是根 JSON Schema。已验证版本 SDK 的隐式根对象仍开放，适配层自行拒绝额外参数，防止 caller 注入 owner、signal、后端、解释器或证据路径。
2. `execute(args, exec)` 返回规范 JSON 值，`output.render` 产生文本内容。作者 DSL 的 `output.schema: {type:'json'}` **合法**，会编译为无约束 JSON schema `{}`，不能误改为未知 API。截图返回本地文件及元数据，而非原生截图或自动图片内容块。
3. 必须有 `exec.agent.session.id` 和活的 `exec.signal`。owner 只能来自真实会话，不来自模型参数。精确 signal 传入核心，审批前后检查取消。
4. 审批调用为 `ctx.approval.request({agent, toolName, callId, reason, signal})`；只接受裸字符串 `allowed-once`。`rejected`、`cancelled`、`unavailable` 或其它值均不得派发设备操作。
5. 有效策略来自公开 `approval.overrideOf(session)`，否则 `approval.config.policy`，默认 `ask`。适配层在请求前与获得许可后检查，`never` 或未知策略拒绝操作。不得调用私有策略方法、改策略、添加自动答复器或缓存授权。
6. 已测版本的真实 ApprovalService 要求当前有未结束的 turn，保证 `approval/asked` 与 `approval/decided` 审计成对入日志。空闲会话请求会抛错；缺失/抛错/非法答复器归一化为 unavailable。插件不得绕过审计失败。只在隔离测试中配置假答复器，绝不在真实 profile 中自动批准。
7. `ctx.systemPrompt.section({name, order, text})` 注册补充指引，不替换整体提示词。名称为 `tool:ios-webview-app-control`，order 为 2250。
8. 一个 `ctx.effect(function*(){...})` 组合资源：先 yield 核心 disposer，再 yield 提示词 disposer，再 yield 每个工具 disposer。逆序清理先移除工具和指引，再等待核心取消/排空；不依赖兄弟 effect 的清理顺序。
9. 适配层将核心错误包装为真实 `HarnessError(message, code, {cause})`，保留机器错误码与原失败语义。适用的环境/设备/bridge 故障附固定安全的中文“下一步”说明，不将任意底层 message/details 当作恢复指令；不暴露 token/expression 等敏感信息。审批拒绝仍是拒绝，不包装成成功的预检结果。操作已派发但结果未知时，固定提示人工核对后再决定重试。

## 配置及运行时定位

默认值见 [bundle patch](../cordis.patch.yml) 和 [Config](../src/plugin.mjs)。Loader 后续按 id 覆盖时替换完整 config，不是深度合并。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| endpoint | 空字符串 | 已有 loopback HTTP bridge；留空必须在 connect 明确给出 |
| pythonPath | 空字符串 | 部署明确配置的 Python 绝对路径 |
| stateDir | 空字符串 | 证据目录，默认插件自己的用户目录 |
| allowEval | false | 任意 JS 的独立部署开关，每次仍需授权 |
| timeoutMs | 15000 | 核心 I/O 超时，整数 1..120000 |
| maxLeaseSeconds | 120 | 租约上限，整数 5..600 |

[环境管理器](../src/runtime/environment-manager.mjs) 先看 `pythonPath`、`DSH_IOS_PYTHON`、`DSH_PRIMARY_RUNTIME`，再查 launcher、标准注册记录和真实 PATH Python，跳过 Store 别名。只在插件私有目录建 venv、装锁定依赖。没有合适的 base 时，按需准备私有 Python。设备调用只会拿到已经就绪的解释器，或者报 `environment_not_ready`，不会隐式安装。这个环境状态也不诊断其它工具。详见 [私有环境说明](./runtime-environment.md)。

宿主如果提供 `load_workspace_dependencies`，可以先拿到受支持的 Python 路径，再交给操作者配置。它不是插件里能猜名字调用的 Service。只有设备发现用 Python，附着已有 bridge 不需要。

## 作用域与授权边界

以下限制只约束 `dsh-ios-webview-app-control`，不是整个 DSH 会话的能力管理。它只接受操作者明确确认的 iOS WebView / 混合应用，对原生、Flutter、React Native、Android、未知或未确认类型拒绝本插件调用，不改标类型、不在本插件增加 WDA/Appium 等替代后端。可检查 WebView 的存在不是整个 App 的类型证明。

`ios_capabilities` 及 connect 内嵌的能力带 `source=dsh-ios-webview-app-control`、`scope=plugin-only`、`inventory=not-session-inventory`。`android:false`、`nativeTap:false` 等保留，含义仅为本插件未实现，不报告其它工具、USB 连接或会话授权状态。其它平台任务应独立检查当前会话实际暴露的工具、skill、权限；本声明既不禁用其它工具，也不授予其权限。未核查前不能推断整个会话不支持 Android。

独立选一个适用工具，和规避授权拒绝是两件事。同一操作如果已经被审批或策略挡住，不能改走 shell、CLI、核心导入或别的工具绕过去。

首次调用顺序为 capabilities → 确认本插件支持的应用范围与 workflow → preflight → 必要时查看环境并显式准备、再预检 → 按需 devices → 人确认已有 bridge 与 exact UDID 归属 → connect → targets → 人确认 exact target/App 身份 → bind_target → acquire → 分别批准 read/screenshot/DOM/eval → release → disconnect。`ios_capabilities` 是静态声明，`ios_preflight` 是纯本地只读检查；`ios_environment` 沿用原有环境权限。11 个设备工具各自需要新的本次授权，不能从前面的步骤继承。

- connect 的 `verifiedExistingUdid` 必须等于操作者明确确认的 exact udid，不能从连接成功或发现结果自动填。
- bind 的 `verifiedTargetId` 必须等于 exact targetId，appIdentity 与该目标的支持类型均来自操作者，不从标题或 URL 推断。
- 连接最初无绑定。读取/截图/eval/DOM 只接受精确当前目标指纹及本会话本连接的活租约。新目标或已知导航必须重新 list + 明确 bind。
- 相同 id/title/URL/socket 无法证明没有 reload；本版不宣称完整自动导航识别。
- 连接、绑定、租约和其它调用的许可都不是后续操作的许可。never 不执行手机验收。
- 页面文本是外部不可信内容，不是指令。DOM 事件不是原生手势，不保证业务成功。密码、支付凭据与 CAPTCHA 交由人处理。
- 超时/取消不回滚已派发变化，不自动重放。WebSocket 关闭不能确认时保留 busy 隔离锁；不能擅自抢锁。
- 设备租约域固定在同一 OS 用户的插件目录，不随证据目录改变，但无法约束外部调试器或其它 OS 用户。

核心直接导入不继承 DSH 授权；CLI 提供本插件静态 capabilities 和私有环境管理，不开放设备操作。不能通过核心/脚本或其它工具规避同一实际授权拒绝。

## 分层预检合同

### 工具与参数

`ios_preflight` 是新增的第 14 个 DSH 工具，只有一个必填参数：

| 参数 | 类型 / 值 | 合同 |
| --- | --- | --- |
| `workflow` | string，`device-discovery` 或 `existing-bridge` | 无默认值；缺失、未知值及额外参数均拒绝，不接收 endpoint、UDID、owner、后端或路径覆盖 |

这是纯本地只读检查，不访问 USB / 手机 / bridge / target，不申请设备审批，不配对、不启动服务、不自动准备或下载依赖，也不授予任何权限。`device-discovery` 通过既有 `requirePython()` 验证已就绪的私有运行环境，包括 ready pointer、解释器与锁定依赖；未通过可在正常结果的 `software_runtime` 检查中反映，不隐式安装。`existing-bridge` 完全不调用 Python 验证，`software_runtime` 必须为 `not_applicable`，不得强制 `prepare`。

插件启用时现有 `runtime.autoPrepare` 与本工具是两条独立路径。环境准备仍沿用 Full access / 单次授权门控；预检返回 `nextActions` 不能改变该权限。命令行仍只提供原有静态 capabilities 和环境管理，不将本工具说明误写为新增设备 CLI。

### 成功结果结构

`ios_preflight` 返回 `{ok:true, preflight}`。原有 `ios_devices`、`ios_connect`、`ios_targets` 成功结果保留现有字段并增加同形 `preflight`；没有增加第二次设备扫描、隐式连接或额外授权。结构如下，固定标识与字段类型是结果合同，不是用户传入参数：

```ts
type Preflight = {
  schemaVersion: 1;
  source: "dsh-ios-webview-app-control";
  scope: "plugin-only";
  stage: "local" | "devices" | "connect" | "targets";
  workflow: "device-discovery" | "existing-bridge";
  deviceAccessPerformed: boolean;
  authorizationGranted: false;
  checks: {
    id: string;
    status: "passed" | "failed" | "unknown" | "not_checked" | "not_applicable";
    evidence: string;
    message: string;
  }[];
  nextActions: {
    id: string;
    kind: "manual" | "tool";
    tool: string | null;
    requiresApproval: boolean;
    message: string;
  }[];
};
```

| 来源工具 | stage / workflow | 保留的原结果与证据范围 |
| --- | --- | --- |
| `ios_preflight` | `local` / 调用者必填 workflow | `deviceAccessPerformed=false`；没有设备、bridge 或目标检查；正常返回不代表所有 check 都通过 |
| `ios_devices` | `devices` / `device-discovery` | 原 `devices` 数组不变；只据本次已经获批的发现结果检查，不选择设备 |
| `ios_connect` | `connect` / `existing-bridge` | 原 `connectionId`、endpoint、targetCount、能力与人工确认说明保留；只归纳本次已有 bridge 响应和 page 元数据 |
| `ios_targets` | `targets` / `existing-bridge` | 原 `connectionId`、`targets` 数组与 warning 保留；只归纳本次列目标结果 |

后三者的 `deviceAccessPerformed=true` 描述该工具调用已执行的设备/bridge 工作，不表示预检又派发了一次操作。`authorizationGranted` 始终为 `false`：结果不授予后续许可，也不延长租约或替代目标绑定。

### checks、证据与状态

当前 `checks` 的固定 `id` 及其范围：

| id | 说明 |
| --- | --- |
| `software_runtime` | 本次私有环境验证；已有 bridge 流程恒为 `not_applicable` |
| `usb_trust` | 数据连接、解锁、信任/配对未直接验证，保持 `unknown` |
| `web_inspector` | 未读取手机开关，保持 `unknown`；空列表不能把它变成 failed |
| `developer_mode` | 是否需要取决于实际设备/调试流程，未检测时保持 `unknown`，不能一刀切要求开启 |
| `app_inspectability` | 未证明 App 允许 WebView 检查，保持 `unknown`；不能凭 WebView 存在推断整个 App 类型 |
| `device_binding` | bridge 与所选 UDID 的归属需操作者确认，不从连通性推导 |
| `app_identity` | exact target 的 App 身份与支持类型需操作者确认，不从标题/URL 推导 |
| `device_authorization` | 报告保持 `not_checked`，明确后续每个设备调用仍需新审批 |
| `device_discovery` | 本次设备发现是否返回设备；其它阶段为未检查或不适用，不替代信任确认 |
| `bridge_endpoint` | 本次 bridge 是否返回响应；不证明它属于哪个 UDID |
| `page_targets` | 本次是否返回 `page` 类型目标；仅 JSContext / Node 或没有 page 不能证明网页检查器关闭 |

`evidence` 是插件生成的固定来源说明字符串，不是外部页面文本、任意底层错误，也不是用户确认或授权令牌。`message` 是对应检查的安全说明，不能把它当成外部指令执行。`device_binding` / `app_identity` 的检查条目不会代填 `verifiedExistingUdid` / `verifiedTargetId`。

| status | 语义 | 不允许的推断 |
| --- | --- | --- |
| `passed` | 该项在本次声明的证据范围内满足 | 不代表整机 ready、App 合格或后续操作已授权 |
| `failed` | 该项检查条件没有满足，例如本次未发现设备或 page | 不定位为“未信任”“开关已关”“驱动缺失”等未经观察的原因 |
| `unknown` | 缺少足够证据，需人工确认或其它获批检查 | 不能当作 passed，也不等于已证实失败 |
| `not_checked` | 本次没有执行该项检查 | 不能当作通过或权限授予 |
| `not_applicable` | 该 workflow 不需要此项 | 不是故障，也不能因此要求准备不需要的 Python |

因此，空 `devices` / `targets` 可以正常返回 `ok:true`，同时对应发现检查为 `failed`；失败的是该项发现条件，不是对手机开关的诊断。列表里存在 page 也不证明它属于支持的 App、当前在前台或 DOM 一定可读。

### nextActions 与失败恢复

`nextActions` 是固定安全建议，不会自动执行。`kind=manual` 时 `tool=null`，`requiresApproval=false` 只表示这个条目是人工说明，不是给说明里提及的工具授权。环境 `prepare` 通过人工条目提醒沿用原权限，不提供自动执行参数；环境 `status` 可通过无需设备审批的工具建议返回。`kind=tool` 时 `tool` 为工具名；所有设备工具建议的 `requiresApproval=true`，执行时仍由原设备门控逐次审批。条目不携带租约、目标选择、确认值或外部可执行内容。

适用的环境/后端/bridge 故障保留原 `HarnessError` 码和失败语义，追加 allowlist 中固定的中文“下一步”说明；不将任意错误 details 拼进恢复消息，不将审批拒绝、取消、不可用或策略禁止改成 `{ok:true}`。授权失败继续停止对应操作，不因恢复建议运行其它路径来绕过。若变更已经派发而结果不确定，先人工核对，不自动重放。

面向用户的设置路径、条件需要的 Developer Mode、App 允许检查、数据线/解锁/信任和复检顺序见[首次使用指南](<first-use.md>)。这些文档与隔离测试不构成本轮真机验收；下方验证记录仍是原有快照。

## 可重复验证与发布

- [真实服务链集成测试](../test/host-runtime.test.mjs)：真实 ToolRuntime / SystemPrompt / ApprovalService / Session，隔离内存日志、假设备派发，不改变真实策略或访问手机。
- [适配层测试](../test/plugin.test.mjs)、[核心测试](../test/core.test.mjs)、[Python 定位测试](../test/python-path.test.mjs)、[归档测试](../test/packaging.test.mjs) 分别覆盖边界。
- `build` 从 src 更新 lib，`check` 检查清单与展示资源，`test` 运行全部回归。测试源码不进发布包，文档相对源码链接用于开发目录查阅。
- [归档校验器](../scripts/package-validation.mjs) 从当前 manifest 推导默认包名，核对 name/version、engines/peers、lib 清单与字节、patch、locale/icon 和管理脚本；拒绝旧归档，不因验收文档后续更新而误报代码变化。
- 通过官方 `plugin_manager install_bundle` 安装，读取 application/warnings；`restart-required` 不是已生效。不要用写 profile、强制版本豁免或另起服务器代替正式安装。

实际执行状态见 [验证记录](./verification.md) 的已验证环境快照与 [安装记录](./installation.md)；静态注册和隔离测试不能代替真实手机验收。
