# 贡献指南

感谢参与 `dsh-ios-webview-app-control`。本项目是 DeepSeek Harness（DSH）的 iOS WebView/混合应用控制插件，范围和安全边界是评审重点。

## 贡献范围

- 只接受操作者明确确认的 **iOS WebView / 混合应用**（`platform=ios`，`appType=webview|hybrid`）。
- 不接受为原生、Flutter、React Native、Android 或未知类型新增后端、兼容层或“顺手支持”。
- 不绕过、削弱或自动化现有审批、目标绑定、设备租约与 `allowEval` 默认禁用等门控。
- 不加入业务路由、账号、真实 UDID、设备证据或“通过/不通过”业务断言。
- 不提交真实凭据、令牌、私钥、本机 profile 备份或用户个人数据。

## 开发

要求 Node.js >= 22.18.0。在仓库根目录执行：

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

- `build` 从 `src` 生成 `lib`；`lib` 是构建产物，不提交。
- 新增行为需要配套测试；提交前确保 `npm test` 全部通过并且没有 skip。
- 涉及设备、审批、环境或 Client 的修改，应说明未覆盖项，不能把静态注册或模拟测试说成真实手机验收。

## 提交 Pull Request

1. 先开 issue 描述问题、复现方式和期望行为；范围变更先讨论。
2. 保持改动聚焦，不混入无关格式化或重构。
3. 提供验证结果，包括实际执行的命令与未覆盖项。
4. 不把本机绝对路径、用户名、内网地址或个人邮箱写进代码、测试或文档。
5. 文档和代码示例必须通用、可移植；需要快照信息时放入“已验证环境（仅开发环境快照）”并注明。

## 安全与隐私

- 不要在公开 issue、PR 或截图中披露账号、令牌、真实设备 UDID、bridge 地址或页面敏感内容。
- 发现安全问题时，先通过仓库维护者可用的私下渠道联系，不要公开细节。
- 未经真实授权，不要提交会在 CI 或本地访问真实设备、配对设备或启动 bridge 的测试。

## 许可证

提交贡献即表示同意按本项目的 **MIT License** 分发，见 [LICENSE](./LICENSE)。
