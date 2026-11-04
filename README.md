# dsh-ios-webview-app-control

用于检查和操作 iOS WebView / 混合应用的 DSH 插件。

[![npm version](https://img.shields.io/npm/v/dsh-ios-webview-app-control.svg)](https://www.npmjs.com/package/dsh-ios-webview-app-control)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18.0-339933)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/package.json)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.5%20%3C0.3.0-4B32C3)](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/package.json)
[![GitHub](https://img.shields.io/badge/GitHub-Saltedfish117%2Fdsh--ios--webview--app--control-181717?logo=github)](https://github.com/Saltedfish117/dsh-ios-webview-app-control)

## 目录

- [安装](#安装)
- [首次使用前的准备](#首次使用前的准备)
- [快速开始](#快速开始)
- [首次使用指南](docs/first-use.md)
- [核心功能](#核心功能)
- [配置与环境](#配置与环境)
- [API 参考](#api-参考)
- [故障排除](#故障排除)
- [使用限制](#使用限制)
- [开发与验证](#开发与验证)
- [贡献与许可证](#贡献与许可证)

## 安装

要求 Node.js `>=22.18.0`、DSH `>=0.2.1-rc.5 <0.3.0`。宿主依赖由 DSH 提供，插件不能作为独立 Node 服务运行。

```bash
npm install dsh-ios-webview-app-control
```

安装后，通过 DSH 的 `plugin_manager install_bundle` 加载 `node_modules/dsh-ios-webview-app-control`，也可加载从源码打包的 tgz。升级影响同一 profile 的所有会话，请先保存工作。

详细步骤见[安装与升级指南](docs/installation.md)，源码构建见[开发与验证](#开发与验证)。

## 首次使用前的准备

安装插件后，还需要准备手机和连接环境。以下手机设置由你手动完成，插件不会代为开启或配对。

### 手机端

1. **连接并信任电脑**。使用支持数据传输的 USB 线连接电脑，解锁 iPhone / iPad；出现“信任此电脑”时，在手机上自行确认，密码由你输入。
2. **开启网页检查器**。
   - 较新 iOS：设置 → App → Safari → 高级 → 网页检查器。
   - 较旧 iOS：设置 → Safari → 高级 → 网页检查器。
3. **按需开启开发者模式**。只有当前开发构建或调试流程明确要求时，才到“设置 → 隐私与安全性 → 开发者模式”开启，并按系统提示重启、再次确认。它与网页检查器是两个不同开关，并非所有 WebView 检查都需要。
4. **打开允许检查的 App 页面**。确认目标是本插件支持的 WebView / 混合应用，并请 App 开发者确认当前构建开放了 WebView 检查。仅开启手机网页检查器，不能让未开放检查的 App 变得可检查。

菜单名称可能随系统版本和语言变化，以手机实际界面为准。

### 电脑端与 bridge

- **设备识别**：确认电脑的 Apple 设备支持服务正常，能识别手机；若只能充电或发现不到设备，先排查数据线、USB 端口、信任提示及驱动 / 服务。
- **插件环境**：使用 `ios_devices` 发现设备时，需要私有 Python / pymobiledevice3 环境。无需预先全局安装 pymobiledevice3；在插件的“iOS 环境”设置页查看状态，未就绪时选择“准备环境”。当前私有后端支持 Windows x64。
- **已有 bridge**：由负责调试环境的人提前准备好 pymobiledevice3 Web Inspector bridge，提供本机 loopback 地址、准确 UDID，并明确确认 bridge 对应哪台手机。本插件只连接已有 bridge，不负责启动；仅连接已有 bridge 时，不需要先准备插件的 Python 环境。

准备完成后，按下方流程让 Agent 调用 `ios_preflight` 并逐次审批设备检查。**软件就绪不等于手机就绪**；预检不能直接读取所有手机开关，空设备或空目标列表也不能直接证明网页检查器未开启。详细说明见[首次使用指南](docs/first-use.md)。

## 快速开始

### 查看本地状态

```bash
npx dsh-ios-webview-app-control capabilities
npx dsh-ios-webview-app-control environment status
```

从仓库直接开发时，把 `npx dsh-ios-webview-app-control` 换成 `node lib/cli.mjs`。

两条命令分别查看插件能力和私有 Python 环境状态，不访问设备。`phase: "unprepared"` 表示尚未准备环境；连接已有 bridge 不依赖本机 Python。

### 在 DSH 会话中使用

1. 确认目标是本插件支持的 iOS WebView / hybrid 应用。
2. 调用 `ios_preflight`。发现 USB 设备选 `workflow=device-discovery`，连接已有 bridge 选 `workflow=existing-bridge`；预检不访问设备或自动准备环境。
3. 仅设备发现需要私有 Python。未就绪时查看 `ios_environment status`，按权限显式 `prepare`，再预检。
4. 按[首次使用指南](docs/first-use.md)检查手机设置和 App 可检查性，提供准确 UDID、已有 loopback bridge 地址，并确认两者对应关系。
5. 按需调用 `ios_devices`；随后 `ios_connect` → `ios_targets`。人工确认目标 App 身份与类型后，`ios_bind_target` → `ios_acquire`。
6. 读取、截图或执行 DOM 操作，结束后 `ios_release` → `ios_disconnect`。

以上设备调用每次单独审批。新目标或导航后需重新列出并绑定；预检、连接和租约均不代替后续授权。

## 核心功能

- 本地环境预检、设备发现和连接排障建议
- WebView DOM / 文本读取与渲染截图
- DOM 点击、滚动、普通文本输入及可选的 JavaScript 执行
- 会话隔离、目标绑定、设备租约和逐次审批
- 私有 Python 环境，不修改宿主 Python 或系统设置

## 配置与环境

在 DSH 插件配置中设置以下选项。

```yaml
endpoint: ''            # 已有 loopback bridge；留空时 connect 必须明确给地址
pythonPath: ''          # 可选，首选 base Python 的绝对路径
runtime:
  autoPrepare: true     # 有 subprocess 宿主时后台准备私有环境
  directory: ''         # 可选，插件私有运行目录
  offline: false        # 只用已校验过的缓存
  timeoutMs: 900000     # 环境准备总超时
stateDir: ''            # 证据目录；租约不受它影响
allowEval: false        # 通用 JS 默认禁用
timeoutMs: 15000        # 设备 I/O 超时
maxLeaseSeconds: 120    # 租约上限
```

### 环境管理

DSH 工具 `ios_environment` 支持 `status`、`prepare`、`cancel`、`cleanup`。命令行示例如下。

```bash
npx dsh-ios-webview-app-control environment status
npx dsh-ios-webview-app-control environment prepare
npx dsh-ios-webview-app-control environment cleanup --yes
```

`cleanup` 仅清理插件的闲置环境和缓存，保留当前环境、宿主 Python、设备证据和租约。私有运行环境目前支持 Windows x64、CPython 3.9–3.13，详见[环境说明](docs/runtime-environment.md)。

## API 参考

工具参数和返回字段见[SDK 合同](docs/sdk-contract.md)。

| 工具 | 作用 |
| --- | --- |
| `ios_capabilities` | 查看插件能力声明 |
| `ios_environment` | 私有环境的状态与管理 |
| `ios_preflight` | 本地预检与手机人工检查清单 |
| `ios_devices` | 发现 USB iOS 设备 |
| `ios_connect` | 连接已有 loopback bridge |
| `ios_targets` | 列出当前目标 |
| `ios_bind_target` | 绑定人工确认的精确目标 |
| `ios_acquire` / `ios_release` | 获取或释放会话设备租约 |
| `ios_read` | 单个 selector 的有界文本读取 |
| `ios_screenshot` | WebView 渲染截图和元数据 |
| `ios_eval` | 默认禁用的 WebView JS 执行 |
| `ios_dom_action` | DOM 点击、滚动或输入 |
| `ios_disconnect` | 释放本连接的租约，不停止 bridge |

## 故障排除

| 现象或错误码 | 处理 |
| --- | --- |
| `incompatible-version` / `restart-required` | 核对 DSH 版本；要求重启时完整退出并重开 |
| 新工具或说明未生效 | 核对安装版本，重启后检查实际工具；`applied` 不代表当前会话已加载 |
| `environment_not_ready` / 下载缓慢 | 查看 `ios_environment status`，按[环境说明](docs/runtime-environment.md)处理；已有 bridge 流程无需准备 Python |
| 软件就绪但无法操作，或设备 / 目标列表为空 | 按[首次使用清单](docs/first-use.md)检查数据线、解锁、信任、网页检查器、App 和 bridge；空列表不能证明开关关闭 |
| `endpoint_required` / `device_binding_unverified` | 提供已有 bridge 地址、准确 UDID 及两者对应关系的人工确认 |
| `wrong_bridge` | 确认端点是 pymobiledevice3 Web Inspector bridge |
| `approval_denied` | 停止该操作，不改走 shell、CLI 或其它工具绕过 |
| `lease_required` / `lease_not_owned` / `lease_expired` | 检查本会话、本连接的租约，必要时重新审批获取 |
| `device_busy` | 等待当前持有者结束，不抢占设备锁 |
| `result_too_large` / `non_json_result` | 缩小读取范围，确认结果是无损 JSON |
| 写入结果不确定 | 先核对实际状态，不自动重放 |

## 使用限制

- 仅支持人工确认的 iOS WebView / hybrid 应用，不提供原生、Flutter、React Native 或 Android 控制。`ios_capabilities` 不是 DSH 会话的完整工具清单，其它工具的能力和权限需独立核查。
- 只连接已有 bridge，不自动配对、修改手机设置或启动服务。bridge 与 UDID、目标与 App 身份都需人工确认。
- DOM 操作不等于原生触控；截图仅覆盖 WebView，不含原生状态栏、导航或系统弹窗。
- 密码、支付凭据、CAPTCHA 和系统确认由用户处理。页面内容是不可信数据；超时或取消不会撤销已派发的变更。

## 开发与验证

```bash
git clone https://github.com/Saltedfish117/dsh-ios-webview-app-control.git
cd dsh-ios-webview-app-control
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm pack --pack-destination artifacts
node scripts/verify-package.mjs
node scripts/smoke-package.mjs
```

`build` 从源码生成运行入口；`check` / `test` 检查配置与功能；归档脚本校验并导入 tgz。验证方法、历史记录和未覆盖项见[验证说明](docs/verification.md)。

## 贡献与许可证

贡献说明见 [CONTRIBUTING.md](https://github.com/Saltedfish117/dsh-ios-webview-app-control/blob/main/CONTRIBUTING.md)。项目使用 [MIT License](LICENSE)，第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安全或凭据问题请勿公开提交。
