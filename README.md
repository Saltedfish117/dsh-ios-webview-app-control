# dsh-ios-webview-app-control

> Business-free DSH tools for inspectable iOS WebView/hybrid apps only.

这是 DeepSeek Harness（DSH）的插件，用来操作操作者明确确认的 iOS WebView 或混合应用。每次操作单独审批，目标要精确绑定，设备租约按会话隔离。原生、Flutter 和 Android 不在范围内。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18.0-339933)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/package.json)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.5%20%3C0.3.0-4B32C3)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/package.json)
[![GitHub](https://img.shields.io/badge/GitHub-Saltedfish117%2Fdsh--ios--webview--app--control-181717?logo=github)](https://github.com/Saltedfish117/dsh-ios-webview-app-control)

> npm 上还没有这个包，所以不放 npm version 徽章。仓库也还没配 CI，build 和 coverage 没有真实数据，暂不展示。

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [核心功能](#核心功能)
- [用法与示例](#用法与示例)
- [API 参考](#api-参考)
- [故障排除](#故障排除)
- [背景与边界](#背景与边界)
- [开发与验证](#开发与验证)
- [贡献与许可证](#贡献与许可证)
- [已验证环境（仅开发环境快照）](#已验证环境仅开发环境快照)

## 安装

这是一个 DSH 插件，不能当独立 Node 服务跑。下面这些 peer dependencies 由 DSH 宿主提供，别单独 `npm install`。

| Peer dependency | 版本范围 |
| --- | --- |
| `@deepseek-ai/cordis` | `~4.0.5` |
| `@deepseek-ai/dsh-tools` | `^0.2.1-rc.5` |
| `@deepseek-ai/dsh-system-prompt` | `^0.2.1-rc.5` |
| `@deepseek-ai/dsh-user-approval` | `^0.2.1-rc.5` |
| `@deepseek-ai/dsh-llm` | `^0.2.1-rc.5` |
| `@deepseek-ai/dsh-typert-protocol` | `^0.2.1-rc.5` |

### 现在从仓库安装

npm 上还没有这个包。先拉仓库、构建，再通过目标 DSH 的插件管理入口安装。

```bash
git clone https://github.com/Saltedfish117/dsh-ios-webview-app-control.git
cd dsh-ios-webview-app-control
npm ci --ignore-scripts
npm run build
npm pack --pack-destination artifacts
```

然后在 DSH 中使用 `plugin_manager install_bundle` 指向 `<project-root>` 或生成的 tgz。安装、升级与生效判定见 [安装与升级指南](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/docs/installation.md)。

### 发布到 npm 之后

```bash
npm install dsh-ios-webview-app-control
```

现在执行会返回 404，发布之后才能用。上面那张表里的 peer dependencies 也不要单独装，版本得跟目标 DSH 宿主对上。

安装或升级会影响同一 profile 的所有会话，动手前先确认没有未保存的工作。

## 快速开始

### 不用手机，先验证插件和 CLI

```bash
npm ci --ignore-scripts
npm run build
node lib/cli.mjs capabilities
node lib/cli.mjs environment status
```

跑完应该看到两类输出。

- `capabilities` 里有 `scope: "plugin-only"` 和 `inventory: "not-session-inventory"`。`android`、`nativeTap` 这些是 `false`，意思是本插件没做，不代表整个 DSH 会话的工具清单。
- `environment status` 显示本插件私有环境到了哪一步、解释器从哪来，不碰设备。

### 在 DSH 会话中最小流程

1. 先跑 `ios_environment status` 看本机环境，没就绪再 `prepare`。这一步不访问手机。
2. 跑 `ios_capabilities`，确认本插件只接受 iOS WebView 和 hybrid。
3. 由操作者确认设备 UDID，以及已有 loopback bridge 绑的是哪台设备。
4. 依次调用 `ios_connect → ios_targets → ios_bind_target → ios_acquire`。
5. 读和截图分别批 `ios_read` 和 `ios_screenshot`，写操作再单独审批。

这些都是 DSH 工具调用，不能当独立的 HTTP 或 JavaScript API 用。要跑通，得有真实的 DSH 会话、已经起来的 bridge，以及逐次审批。

## 核心功能

- 只接受操作者明确确认的 iOS WebView 或混合应用
- 复用已经运行的 loopback Web Inspector bridge，不自己拉服务
- 发现 USB 设备、列出目标、绑定到具体目标
- 有界读取 DOM 和文本，能截 WebView 渲染图
- 受控的 DOM click、scroll 和标准文本输入，eval 默认关着
- 每次操作单独审批，连接归会话所有，设备租约和目标指纹都会校验
- 私有 Python/venv 环境，不动宿主 Python 和系统环境

## 用法与示例

### 设备流程

| 步骤 | 工具 | 关键要求 |
| --- | --- | --- |
| 1 | `ios_environment status` | 只读；未就绪时再 `prepare` |
| 2 | `ios_devices` | 发现 USB 设备；不选择、不连接 |
| 3 | `ios_connect` | 明确 `platform=ios`、`appType=webview/hybrid`、UDID 与操作者确认的 bridge |
| 4 | `ios_targets` | 读取新鲜 target；不据此推断 App 类型 |
| 5 | `ios_bind_target` | 操作者确认 exact target 的 App 身份与类型后绑定 |
| 6 | `ios_acquire` | 获取本会话、本连接专属的限时租约 |
| 7 | `ios_read` / `ios_screenshot` | 每次单独审批；截图是 WebView 渲染图 |
| 8 | `ios_dom_action` / `ios_eval` | 写操作另批；eval 还需部署开启 `allowEval` |
| 9 | `ios_release` / `ios_disconnect` | 释放租约；不停止外部 bridge |

### 配置

```yaml
endpoint: ''            # 已有 loopback bridge；留空时 connect 必须明确给地址
pythonPath: ''          # 可选：首选 base Python 绝对路径
runtime:
  autoPrepare: true     # 有 subprocess 宿主时后台准备私有环境
  directory: ''         # 可选：插件私有运行目录
  offline: false        # 只使用已校验缓存
  timeoutMs: 900000     # 环境准备总超时
stateDir: ''            # 证据目录；租约不受此影响
allowEval: false        # 通用 JS 默认禁用
timeoutMs: 15000        # 设备 I/O 超时
maxLeaseSeconds: 120    # 租约上限
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | 空 | 已有 loopback bridge；不自动启动 |
| `pythonPath` | 空 | 首选 base Python；依赖始终安装到私有 venv |
| `stateDir` | 空 | 证据目录；设备租约固定在用户目录 |
| `allowEval` | `false` | 开启后仍需逐次审批 |
| `timeoutMs` | `15000` | 设备 I/O 超时，1..120000 ms |
| `maxLeaseSeconds` | `120` | 租约上限，5..600 秒 |
| `runtime.autoPrepare` | `true` | 只准备本插件环境，不访问设备 |
| `runtime.directory` | 空 | 插件私有运行目录 |
| `runtime.offline` | `false` | 禁止网络下载缺失资源 |
| `runtime.timeoutMs` | `900000` | 环境准备总超时 |

### 环境管理

`ios_environment` 有 status、prepare、cancel、cleanup 四个动作，CLI 也能直接调。

```bash
node lib/cli.mjs environment status
node lib/cli.mjs environment prepare
node lib/cli.mjs environment cleanup --yes
```

清理只删除本插件拥有的闲置运行环境与缓存，不删除宿主 Python、设备证据或租约。详见 [私有运行环境说明](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/docs/runtime-environment.md)。

### 常见错误

| 错误码 | 含义与处理 |
| --- | --- |
| `unsupported_platform` / `unsupported_app_type` | 本插件拒绝该目标；不代表会话其它工具不可用 |
| `approval_denied` | 审批缺失、never、拒绝或取消；不要改走其它工具执行同一操作 |
| `environment_not_ready` | 私有环境未就绪；先 `ios_environment status` / `prepare` |
| `endpoint_required` / `device_binding_unverified` | connect 前需明确 bridge 与操作者确认的 UDID |
| `wrong_bridge` | 端点不是 pymobiledevice3 Web Inspector bridge |
| `lease_required` / `lease_not_owned` / `lease_expired` | 租约缺失、不属本会话或已过期 |
| `device_busy` | 同设备已有租约或命令进行中；不要抢锁 |
| `result_too_large` / `non_json_result` | 结果超出边界或不是无损 JSON |

## API 参考

完整的工具参数、审批、作用域与 SDK 合同见 [DSH SDK 合同](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/docs/sdk-contract.md)。工具定义源在 `src/plugin.mjs`，运行期以 Host 实际注册的 schema 为准。

| 工具 | 作用 |
| --- | --- |
| `ios_capabilities` | 本插件静态能力声明；不是会话工具清单 |
| `ios_environment` | 私有环境状态与管理 |
| `ios_devices` | 发现 USB iOS 设备 |
| `ios_connect` | 附着已有 loopback bridge |
| `ios_targets` | 列出 target 元数据 |
| `ios_bind_target` | 绑定操作者确认的 exact target |
| `ios_acquire` / `ios_release` | 获取/释放会话设备租约 |
| `ios_read` | 唯一 selector 的有界文本读取 |
| `ios_screenshot` | WebView 渲染截图与元数据 |
| `ios_eval` | 默认禁用的 WebView JS 执行 |
| `ios_dom_action` | 单元素 DOM click/scroll/input |
| `ios_disconnect` | 释放本连接租约；不停止 bridge |

## 故障排除

| 现象 | 处理 |
| --- | --- |
| 安装返回 `incompatible-version` 或 `restart-required` | 核对 `engines.dsh` / peers；不要加版本豁免；需要时完整重启 DSH |
| 新说明或工具行为未生效 | `applied` 不等于当前 Agent 已加载；完整重启后核对真实工具 |
| `environment_not_ready` 或准备下载慢 | 查看 `ios_environment status`；检查网络；失败后显式重试 |
| 设备已连接但无法操作 | 核对本会话工具范围、bridge、UDID、目标绑定与审批；连接成功不等于已授权 |
| 目标是 Android/原生/Flutter | 本插件不处理；独立检查会话中其它工具与权限，不要用本插件的能力做全会话判断 |
| 写入结果未知 | 不要自动重放；先核对实际状态，再决定是否重试 |

## 背景与边界

插件把 DSH 的工具注册、逐次审批、会话归属和设备租约，接到已经运行的 pymobiledevice3 Web Inspector CDP bridge 上。

```text
DSH 工具 + 逐次授权
        ↓ 通用 CDP 客户端
已运行的 pymobiledevice3 Web Inspector CDP 桥接（仅 loopback）
        ↓ Apple USB 配对 / Web Inspector 服务
iPhone 上允许检查的 WKWebView
```

这里说的限制都只针对本插件。`ios_*` 的能力结果也是。`android:false`、`nativeTap:false` 只说明本插件没实现，不代表别的工具不存在、被禁用或者已经授权。`ios_capabilities` 不是 DSH 会话的完整工具清单，也不检查 USB 连接。Android、原生、Flutter 这类任务，去看当前会话实际提供了哪些工具、skill 和权限，没查清之前别下「整个会话不能操作」的结论。

本插件不做完整原生 UI 控制、原生元素树、原生 tap/swipe、系统权限弹窗、原生相册和系统手势，也不碰支付、密码和 CAPTCHA。DOM click 不是原生触控，程序化 scrollTop 不是手指滑动，WebView 截图也不包含原生状态栏、导航和弹窗。

页面内容是外部数据，不能当指令。已经派发的变更不会因为超时或取消回滚，结果不确定就先核对，别自动重放。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm pack --pack-destination artifacts
node scripts/verify-package.mjs
node scripts/smoke-package.mjs
```

- `build`：从 `src` 生成 `lib` 并做 Node 语法检查。
- `check`：检查包入口、bundle 配置、运行资源锁、元数据、图标与文档链接。
- `test`：真实 DSH 服务链、Typert/Client、环境管理、作用域专项、核心与租约、归档校验。
- `verify-package` / `smoke-package`：校验归档并实际导入。

验证方法与未覆盖项见 [验证说明](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/docs/verification.md)。

## 贡献与许可证

- 贡献方式与范围边界见 [CONTRIBUTING.md](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/CONTRIBUTING.md)。
- 安全或凭据问题不要公开披露，请先通过仓库维护者可用的私下渠道联系。
- 本项目使用 **MIT License**，见 [LICENSE](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/LICENSE)。
- 第三方运行环境与 Python 依赖的许可见 [THIRD_PARTY_NOTICES.md](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/THIRD_PARTY_NOTICES.md)。

## 已验证环境（仅开发环境快照）

这是某次开发验证的快照，只说明当时验过什么。它不是安装要求，也不是兼容承诺，换台机器路径、profile、端口和版本都可能不一样。

- 插件版本 0.2.1；固定归档 SHA256 见 [验证记录](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/docs/verification.md)。
- 验证平台：Windows x64；Node 22.18.0；DSH 0.2.1-rc.5；Cordis 4.0.5；Schemastery 3.18.5。
- 自动验证：204 项项目测试通过；tgz 解包导入 smoke 通过；完整重启后在真实 Host 工具中确认 `scope=plugin-only`、`inventory=not-session-inventory` 及新的作用域说明。
- 未覆盖：真实 iOS 手机操作、私有 Python 环境完整准备、UI 视觉渲染；审批策略未改变。
