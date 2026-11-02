# 私有 Python 运行环境

`0.2.0` 不再要求用户预先安装 `pymobiledevice3`。

## 选择与隔离

1. 插件检测明确配置、`DSH_IOS_PYTHON`、`DSH_PRIMARY_RUNTIME`、Windows `py.exe`、标准注册记录和真实 PATH Python；跳过 Windows Store 别名。
2. 只接受 64-bit CPython，且该 Python 的 ABI 在 [runtime-lock.json](../resources/runtime-lock.json) 中有完整、逐 wheel SHA256 锁定的依赖闭包。当前锁支持 CPython 3.9–3.13；3.14 因 `pylzss` 没有满足条件的 Windows wheel 不接受。
3. 宿主 Python 只用作 base，不向它安装任何包。`pymobiledevice3` 和所有传递依赖安装到用户目录 `.dsh-ios-webview-app-control/runtime/generations/...` 的私有 venv，使用 `--no-index --require-hashes --only-binary :all: --require-virtualenv --no-user`。
4. 没有合适宿主时，下载锁定的 PBS CPython 3.13.18 Windows x64，先验证大小和 SHA256，再安全解包到插件自己的 base 目录。
5. `venv` 从最终 generation 路径创建，不移动；ready 指针原子发布。失败或取消不替换上一个 ready 环境。准备锁采用保守 fail-closed：发现已有锁时不会自动抢占，即使旧 PID 已结束也需后续明确清理。

默认配置：

```yaml
runtime:
  autoPrepare: true       # 有 subprocess 宿主时后台准备；不访问设备
  directory: ''           # 默认用户目录 runtime；必须是插件私有绝对目录
  offline: false          # 只使用已经通过哈希校验的缓存
  timeoutMs: 900000       # 10,000..3,600,000 ms
```

`autoPrepare` 只初始化本地环境，不包含 `usbmux list`、设备配对、bridge 启动或手机审批。若没有 DSH managed subprocess，插件仍可查看状态；用户可以通过 `ios_environment prepare` 或 CLI 准备。

## 状态与操作

- `ios_environment status`：只读查看阶段、来源、ABI、私有解释器路径、下载进度和安全错误摘要。
- `ios_environment prepare`：环境已在 Full access 或一次性授权下准备；下载来源、版本、哈希由包内锁定资源决定，wire 参数不能覆盖。
- `ios_environment cancel`：取消当前准备并等待其自有子进程范围结束。
- `ios_environment cleanup`：二次确认后只删除插件拥有的闲置 generation/base/cache，保留 active ready 环境、截图证据、设备租约和宿主 Python。

设置页提供相同状态与操作。页面只订阅 status/follow，不在挂载时自动 prepare；取消可中止进行中的 prepare。当前环境 ready 不表示手机连接、App 类型确认或设备操作授权。

## 失败与恢复

网络、证书、HTTP、超时、磁盘、权限、锁、哈希、归档路径、缺失 wheel、Python/DLL、自检错误都会 fail closed；不切换未锁定版本、不关闭 TLS、不源码编译、不静默安装系统 VC Runtime。准备失败保留上一 ready pointer，修复原因后可重试。`requirePython()` 只返回已验证的私有 venv 解释器，不会在 `ios_devices` 调用里隐式安装。

## 分发与许可证

npm 包不内置约 22 MB 的 PBS 压缩二进制或约 76 MB 的依赖 wheel；只带锁、代码和许可原文。缺少宿主时首次准备按需下载。`pymobiledevice3` 是 GPL-3.0-or-later；PBS/CPython及其内嵌库各自适用许可，完整来源见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
