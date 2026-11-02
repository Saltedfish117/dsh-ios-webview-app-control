# 验证说明

本文说明如何验证本插件，以及结果如何判定。具体一次开发验证的原始记录见文末“已验证环境（仅开发环境快照）”。

## 验证范围与边界

- 本插件只描述自己的 `ios_*` 工具能力；不是 DSH 会话的完整工具清单。
- 验证不得访问未授权设备；自动测试使用隔离 Context、内存 Session 与假设备派发。
- 本验证不覆盖其它平台工具、真实手机业务、私有 Python 环境完整性或 UI 视觉渲染。

## 自动验证

在项目根目录执行：

```powershell
npm run build
npm run check
npm test
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
npm pack --pack-destination artifacts
node scripts/verify-package.mjs
node scripts/smoke-package.mjs
```

判定标准：

- build 从 `src` 生成 `lib` 并做 Node 语法检查。
- check 校验包入口、bundle 配置、运行资源锁、中英文元数据、图标及文档链接。
- test 覆盖 ToolRuntime/SystemPrompt/ApprovalService/Session 服务链、Typert Gateway/Client、环境管理、作用域专项、核心与租约、归档校验；应全部通过且无 skip。
- verify-package 校验归档 version/engines/peers、全部 lib 字节、Client、locale、资源锁与许可原文一致。
- smoke-package 从 tgz 实际导入、注册 13 个工具、拒绝 Flutter 与 never、清理完成，不访问设备。

## 作用域专项回归

- `ios_capabilities` 含 `source`、`scope=plugin-only`、`inventory=not-session-inventory`；`android`、`nativeTap` 等保持 false。
- 独立注册的 fixture 工具不会因本插件 false 被隐藏，也不能被当作已授权。
- Android/native/Flutter/unknown 仍在本插件入口拒绝；审批与设备 I/O 为零。
- 审批拒绝后不能通过 shell、CLI、核心导入等改道执行同一操作。
- CLI、connect 内嵌能力、UI 文案与文档表达同一作用域。

## 运行时验收

- Config 查询存在 `include:ios-webview-app-control`，且 schema 可用。
- Tool Inspect 显示 13 个工具；`ios_capabilities` 描述应说明“不是会话能力清单或连接检查”。
- 真实调用 `ios_capabilities` 返回新作用域字段。旧进程或旧 Agent 可能继续返回旧模块结果，需要完整重启后复验。
- `applied`、`enabled`、fiber `active` 都不能替代实际工具调用与描述核对。

## 未覆盖项

- 未访问或操作真实 iOS/Android 手机；未证明目标技术类型、UDID、App 身份、USB 连接或业务结果。
- 未调查其它会话工具；不能从本插件 scope 标记推断外部工具存在或缺失。
- UI/图标视觉渲染未验收；Client 仅通过隔离注册与测试核对。
- 旧会话历史中的错误结论不会因升级自动消失。

## 已验证环境（仅开发环境快照）

以下为一次开发验证快照，不是兼容承诺或运行前提。

- 2026-10-31，Windows x64；Node 22.18.0；DSH 0.2.1-rc.5；Cordis 4.0.5；Schemastery 3.18.5。
- 0.2.1 归档 57 文件、163,988 字节，SHA256 `e62eae32011c1d394bbc35e94b805ceb39c55f162dbb080facb02bcf9d73d138`；204 项测试通过（0 failed，0 skipped）；build、check、pack、verify-package、smoke 均通过。
- 修订前 GUIDANCE + 13 工具 schema 为 13,424 UTF-8 字节，修订后 13,387 字节（按 bytes/4 粗估 3,356 → 3,347，不是供应商 tokenizer）。
- 完整重启前真实工具与描述仍为旧内容；重启后 `ios_capabilities` 返回 scope/inventory，新描述生效。该对照说明 `applied` 不等于当前 Agent 已加载新说明。
- 该快照中私有 Python 环境准备未完成（下载阶段 `runtime_timeout`），不作为已验收项。
- 0.2.0 的 199 项回归和安装是上一版本历史，不能冒充 0.2.1 的说明/运行时验收。
