# 第三方运行环境与许可声明

插件自己的 JavaScript 源码按 [MIT](./LICENSE) 分发。下列独立 Python 解释器与软件包不因此变更许可；不得把整个运行环境称为 MIT。

## 按需取得的运行环境

本 npm 包仅带代码、资源锁与许可证文本，不内置 Python 或 wheel 二进制。初始化从锁定的上游地址下载原始发布文件，校验大小和 SHA256 后，仅安装到本插件用户运行目录。运行时不替用户发布、上传或镜像这些软件。

### Python Build Standalone / CPython

- 项目：<https://github.com/astral-sh/python-build-standalone>。
- 固定发行：20261026；备用 CPython：3.13.18 Windows x64，标准 GIL、install_only_stripped。
- 分发资产与完整性摘要记录在 [运行资源锁](./resources/runtime-lock.json)。
- Python 本体适用 PSF 及其历史许可，见 [CPython 原文](./resources/notices/PYTHON-LICENSE.txt)。PBS 构建工具仓库的 MPL-2.0 不等于其产物中所有软件的许可。
- PBS install_only 转换不会保留 full 包的额外 licenses 目录，因此本包随附同发行原文，涵盖 CPython、bzip2、Expat、libffi、liblzma、OpenSSL 3、SQLite、Tcl、Tix 与 zlib。见 [许可来源和哈希](./resources/notices/provenance.json)。已解压运行时的 LICENSE.txt、wheel 中 dist-info/licenses 均保留。
- Windows UCRT 是操作系统组件；插件不会修改或安装系统 VC Runtime。缺失 DLL 会报告准备/自检失败，不复制其它安装目录的 DLL，也不静默执行系统安装器。

### pymobiledevice3

- 版本：11.45.0。
- 项目与对应源代码：<https://github.com/doronz88/pymobiledevice3/tree/v11.45.0>。
- 原始分发：<https://pypi.org/project/pymobiledevice3/11.45.0/>。
- 许可：**GPL-3.0-or-later**，原文见 [GPL 许可文本](./resources/notices/PYMOBILEDEVICE3-LICENSE.txt)。
- 插件通过受控子进程运行其 CLI，不修改或合并其源代码。此技术划分不代表免除适用的再分发义务。如果今后提供内置/镜像 wheel 或离线完整包，应在发布前另行提供适用的源码、许可材料及再分发审查。

### 完整 Python 依赖

运行资源锁针对 Windows x64 的 CPython 3.9～3.13 记录完整传递依赖、版本、wheel URL、大小和 SHA256。各软件继续适用自己的元数据/包内许可，不同依赖可能有 MIT、BSD、Apache、GPL/LGPL 或其它条款。安装保留其原始 dist-info 与许可文件，并可通过环境中的包元数据查询。

目前 Python 3.14 的 pylzss 依赖没有满足本方案的 Windows wheel，因此不在锁中；不在用户主机源码编译，而选择经过锁定的私有备用解释器。

## Node.js 直接依赖

`@deepseek-ai/schemastery`、`zod` 及宿主提供的 DSH/Cordis 包分别遵循各自分发文件中的许可。插件界面复用宿主 React，不附带另一份 React，也不从 CDN 下载界面脚本。

## 构建工具

`uv` 只用于开发阶段解析多 Python ABI 的 wheel 闭包，未安装到宿主 Python，也不随插件分发。开发下载来源、版本和哈希保存在构建目录；用户初始化不下载或调用 uv。

## 原创资源

插件图标为本项目原创，按 MIT 分发。
