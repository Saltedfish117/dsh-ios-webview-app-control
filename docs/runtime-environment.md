# 私有 Python 运行环境

`0.2.0` 不再要求用户预先安装 `pymobiledevice3`。

**软件 ready 不等于手机 ready。** 私有环境只服务本插件的设备发现；附着已有 loopback bridge 不依赖 Python。首次手机设置、人工确认与逐次审批见[首次使用指南](<first-use.md>)。

## 分层预检：先区分 workflow

`ios_preflight` 是纯本地只读工具，必须明确 `workflow`；它检查本插件私有软件条件并返回手机人工清单，不访问设备、不请求 bridge、不配对、不启动服务、不自动准备环境，也不授予授权。

| workflow | 软件环境处理 | 后续步骤 |
| --- | --- | --- |
| `device-discovery` | 通过现有 `requirePython()` 只读验证 ready pointer、私有解释器与锁定依赖，不下载、不安装 | 未就绪时查看 `ios_environment status`，在原权限允许下显式 `prepare`，再复跑预检；`ios_devices` 另需本次设备审批 |
| `existing-bridge` | 完全跳过 Python；`software_runtime` 为 `not_applicable` | 不强制 `prepare`；由操作者确认已有 bridge origin、exact UDID 与归属，连接和列目标仍各自审批 |

预检正常返回 `{ok:true, preflight:{...}}` 不表示手机已可操作。`checks` 状态使用 `passed`、`failed`、`unknown`、`not_checked`、`not_applicable`；手机信任、网页检查器、按需 Developer Mode 和 App 允许检查，没有可靠证据就保持未知或未检查。`phase: ready` 是环境管理状态，不是手机状态，也不等同于所有检查 `passed`。字段详见[分层预检合同](<sdk-contract.md#分层预检合同>)。

`ios_devices`、`ios_connect`、`ios_targets` 成功时在原结果中附带相同结构的 `preflight.checks` / `nextActions`，只归纳这次获批调用的证据。设备列表或目标为空不是“已关闭某个开关”的诊断，失败时按固定安全说明人工修复并分别审批复检。

## 选择与隔离

1. 插件检测明确配置、`DSH_IOS_PYTHON`、`DSH_PRIMARY_RUNTIME`、Windows `py.exe`、标准注册记录和真实 PATH Python；跳过 Windows Store 别名。
2. 只接受 64-bit CPython，且该 Python 的 ABI 在 [runtime-lock.json](../resources/runtime-lock.json) 中有完整、逐 wheel SHA256 锁定的依赖闭包。当前锁支持 CPython 3.9–3.13；3.14 因 `pylzss` 没有满足条件的 Windows wheel 不接受。
3. 宿主 Python 只用作 base，不向它安装任何包。`pymobiledevice3` 和所有传递依赖安装到用户目录 `.dsh-ios-webview-app-control/runtime/generations/...` 的私有 venv，使用 `--no-index --require-hashes --only-binary :all: --require-virtualenv --no-user`。
4. 没有合适宿主时，下载锁定的 PBS CPython 3.13.18 Windows x64，先验证大小和 SHA256，再安全解包到插件自己的 base 目录。
5. `venv` 直接在最终 generation 路径创建，不移动。ready 指针原子发布。失败或取消不会替换上一个 ready 环境。准备锁采用保守的 fail-closed 策略，发现已有锁就不自动抢占，哪怕旧 PID 已经结束，也要后续明确清理。

默认配置如下。

```yaml
runtime:
  autoPrepare: true       # 有 subprocess 宿主时后台准备；不访问设备
  directory: ''           # 默认用户目录 runtime；必须是插件私有绝对目录
  offline: false          # 只使用已经通过哈希校验的缓存
  timeoutMs: 900000       # 10,000..3,600,000 ms
```

`autoPrepare` 只初始化本地环境，不包含 `usbmux list`、设备配对、bridge 启动或手机审批。它是插件启用时已有的独立环境生命周期行为，不由 `ios_preflight` 或设备调用触发。若没有 DSH managed subprocess，插件仍可查看状态；用户可以在原有权限允许下通过 `ios_environment prepare` 或 CLI 显式准备。

## 状态与操作

- `ios_environment status`：只读查看阶段、来源、ABI、私有解释器路径、下载进度和安全错误摘要。
- `ios_environment prepare`：环境已在 Full access 或一次性授权下准备；下载来源、版本、哈希由包内锁定资源决定，wire 参数不能覆盖。
- `ios_environment cancel`：取消当前准备并等待其自有子进程范围结束。
- `ios_environment cleanup`：二次确认后只删除插件拥有的闲置 generation/base/cache，保留 active ready 环境、截图证据、设备租约和宿主 Python。

设置页提供相同状态与操作，也长期保留首次连接人工清单。页面只订阅 status/follow，不在挂载时自动 prepare 或访问设备；取消可中止进行中的 prepare。ready 时激活引导自动收起的行为保持不变，不等于手机、App 或 bridge 已通过检查。数据线、解锁、系统信任、网页检查器、条件需要的 Developer Mode，以及 App 允许检查，仍由操作者或开发者处理。

## 失败与恢复

网络、证书、HTTP、超时、磁盘、权限、锁、哈希、归档路径、缺失 wheel、Python/DLL 和自检错误都会 fail closed。不切换未锁定版本，不关 TLS，不源码编译，也不静默安装系统 VC Runtime。准备失败会保留上一个 ready pointer，修好原因后可以显式重试。`requirePython()` 只返回已经验证过的私有 venv 解释器；`ios_preflight` 的设备发现检查和 `ios_devices` 均不会隐式安装。

本地软件问题与手机连接问题分开处理：先按正确 workflow 复跑 `ios_preflight`，人工完成[手机与 App 清单](<first-use.md#2-手机端清单由操作者逐项处理>)，再对每次 `ios_devices` / `ios_connect` / `ios_targets` 等调用分别审批。已有 bridge 的 Python 不适用，不能用强制 `prepare` 修复空目标。适用的环境、设备后端和 bridge 故障保留原错误码并附固定安全的“下一步”说明；审批拒绝、取消、不可用或策略禁止时停止，不改走 CLI、shell 或核心导入规避。

## 分发与许可证

npm 包不内置约 22 MB 的 PBS 压缩二进制或约 76 MB 的依赖 wheel；只带锁、代码和许可原文。缺少宿主时首次准备按需下载。`pymobiledevice3` 是 GPL-3.0-or-later；PBS/CPython及其内嵌库各自适用许可，完整来源见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
