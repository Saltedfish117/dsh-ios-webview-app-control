# 安装与升级指南

这里说明怎么通过官方插件管理通道安装或升级本插件，以及怎么确认它真的生效。不同部署的 profile、DSH 版本、路径和端口不一样，示例里的占位符按实际环境替换。

## 前置确认

1. 确认目标 DSH 版本在 [package.json](../package.json) 的 `engines.dsh` 与 `peerDependencies` 范围内。不要用版本豁免绕过兼容检查；范围外版本未经验证。
2. 先在项目根目录构建并校验待安装归档。

```powershell
npm ci --ignore-scripts
npm run build
npm run check
npm test
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
npm pack --pack-destination artifacts
node scripts/verify-package.mjs
node scripts/smoke-package.mjs
```

3. 用 `plugin_manager list_bundles` 确认目标 profile 与已安装版本，避免装错 profile 或重复安装。

## 通过官方插件管理通道安装

1. 使用目标 DSH 的 `plugin_manager install_bundle` 指向 `<project-root>` 或本地 tgz。不要手写 profile、不改 app.asar、不加版本豁免。
2. 如管理器要求先移除旧版本，按提示移除后安装；安装会选中 bundle 层。
3. 以返回的 `application` 与 `warnings` 判断应用结果；`applied` 仍需要实际核对。
4. 返回 `restart-required` 时，保存会话工作后完整退出并重开 DSH；刷新页面不能替代 Host 模块重启。
5. 安装或升级会影响同一 profile 的所有会话；先确认没有未保存工作。包内文档是打包时快照。

## Desktop 部署的脚本入口

仓库的 [Desktop 管理脚本](../scripts/manage-desktop.ps1) 仅用于 Electron Desktop 安装器部署，调用该安装器自带的官方 `dsh-desktop-host/cli.js`，不绕过 profile 保护，默认操作该 Desktop 部署的 profile。其它 profile 请使用对应插件管理入口或 CLI 显式指定。

```powershell
pwsh -NoProfile -File scripts/manage-desktop.ps1 -Action list
pwsh -NoProfile -File scripts/manage-desktop.ps1 -Action install -CheckOnly
pwsh -NoProfile -File scripts/manage-desktop.ps1 -Action install
# 卸载（不删除证据、不终止外部 bridge）
pwsh -NoProfile -File scripts/manage-desktop.ps1 -Action remove
```

脚本默认归档由当前 `package.json` 版本推导；`-Archive` 可指定其它位置，但仍会校验归档名称、版本、兼容声明、入口与分发资源一致。

## 判定安装是否生效

- Config 查询出现 `include:ios-webview-app-control`，且 schema 状态正常。
- 当前源码的工具发现应包含 14 个工具，其中包括 `ios_environment` 和 `ios_preflight`。
- 0.2.1 起，`ios_capabilities` 返回 `scope=plugin-only`、`inventory=not-session-inventory`，并说明这是本插件自述、不是会话工具清单。
- 安装目录 manifest 版本与待安装归档一致；不能只看 `enabled` 或 fiber 为 active。
- 没看到这些结果，就把原始返回留下来查原因。不要为了通过验证去删环境、扩大插件范围或者改审批。

## 失败与恢复

- 版本不兼容：按错误码处理，不在不满足范围时强行豁免。
- 安装失败或取消：按管理器的恢复结果处理，不手工修改受保护 profile。
- 环境没就绪：用 `ios_environment status` 看本插件状态。它和设备连接、其它工具、授权是三件事。
- 旧版本模块可能继续服务到进程重启；需要新说明生效时，以完整重启后的真实工具结果为准。

## 已验证环境（仅开发环境快照）

这是某次开发验证的快照，既不是安装要求，也不是兼容承诺或运行前提。

- 2026-10-31，Windows x64；DSH 0.2.1-rc.5；Node 22.18.0；Cordis 4.0.5；Schemastery 3.18.5。
- 通过官方管理器移除旧 0.2.0、安装固定 0.2.1 tgz，返回 `application: applied`、`version: 0.2.1`、`warnings: []`；pnpm 另有非阻断 peer 提示。
- 固定包：57 文件、163,988 字节；SHA256 `e62eae32011c1d394bbc35e94b805ceb39c55f162dbb080facb02bcf9d73d138`；204 项测试与 tgz 导入 smoke 通过。
- 重启前真实工具与描述还是旧的。完整重启后，`ios_capabilities` 才返回 `scope=plugin-only`、`inventory=not-session-inventory`，Tool Inspect 也换成新描述。所以 `applied` 不能直接当成「当前 Agent 已收到新说明」。
- 未调用真实设备操作，未修改审批策略；私有 Python 环境准备在该快照中未完成（下载阶段超时），不作为已验收项。
