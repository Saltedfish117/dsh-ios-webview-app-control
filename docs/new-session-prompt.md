# 新会话复用提示词

## 已安装此插件后的操作会话

```text
dsh-ios-webview-app-control 仅提供自己的 ios_* 工具，不是整个 DSH 会话的能力管理器。ios_capabilities 中 android:false、nativeTap:false 等只表示本插件未实现，不代表其它工具不存在、不可用或已获授权，也不检查手机 USB 连接。
对 Android、原生、Flutter、React Native 或其它超范围任务，不拿本插件做能力检测，不要求先准备它的 Python/bridge/租约；独立检查当前会话实际暴露的相关工具、skill 与权限。另有核实可用且已授权工具时按其合同处理；未核查前只说未知，不宣称整个会话不能操作。
如果确实使用本插件，必须由我确认 ios + webview/hybrid、设备 UDID、已有 loopback bridge 绑定及 exact target 的 App 身份；按 connect → targets → bind_target → acquire，并逐次审批后再读/截图/DOM/eval。不能改标应用类型通过本插件校验；新 target/已知导航后重新绑定。
审批拒绝、取消、缺失、不可用或 policy never 阻止同一操作时，不能改走 shell、CLI、核心导入或其它工具规避。判断其它平台任务是否有独立工具，不等于获得调用授权。
只执行我随后明确的任务；不内置业务流程、不启动重复 bridge、不停止其它窗口服务，不把 DOM 事件或 WebView 渲染图当成原生触控或完整设备截图。
```

## 创造模式会话：继续安装和验收

```text
读取项目 README、SDK 合同和验证记录后核对目标 runtime/profile。先 build/check/test/pack，不修改 DSH 安装文件、受保护 profile 或业务项目。
本插件的设备范围仍只接受操作者确认的 iOS WebView/混合应用；Android/原生/Flutter 等应由其它实际可用且已授权的工具独立评估，不能从本插件 false 标志推断全会话不支持。不要在本插件中加入替代后端或改标目标类型。
通过官方插件管理器安装当前校验过的 tgz，按 application/warnings 判断应用状态，安装后核对 source/scope/inventory 标记及真实工具说明。环境状态只诊断本插件；真实设备操作必须另行逐次批准。没有设备/审批/GUI验收条件时准确报告未覆盖，不注册自动批准器。
```

## 能力判读示例

| 场景 | 正确处理 | 不应作出的结论 |
| --- | --- | --- |
| 只有本插件返回 android:false | 本插件不提供 Android 控制；其它会话工具尚未检查 | 整个 DSH 会话不能操作 Android |
| 当前会话另有独立适用工具 | 核对它的声明、目标和授权后再决定调用 | 本插件 false 会禁用其它工具，或其它工具天然已授权 |
| 手机 USB 已连接 | 将连接状态与控制工具、授权分别验证 | 已连接就一定能由 Agent 点击，或不能点击就是连接坏了 |
| 用户说另一个对话能操作 | 检查当前会话实际工具，不复制对话间权限 | 另一个对话成功就证明此处也能调用 |
| 合法 iOS 操作被审批拒绝 | 停止同一被阻止操作，不换道执行 | scope 澄清允许绕过审批 |
