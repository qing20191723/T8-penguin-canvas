# Atlas Canvas — 项目交接与续作入口

> **本文件是新会话接手本项目时必须完整读取的第一入口。** 每次关键修复、PR 合并、Actions 结果、正式发布结果或阻塞点变化后，必须同步更新本文件。

## 0. 最新实时状态（2026-08-05）

- 仓库：`qing20191723/T8-penguin-canvas`
- Render：`https://qingchen-atlascloud-canvas.onrender.com`
- 当前 `main` SHA：`21a2508101f770f305904b48f6a130f47d31992c`
- 当前修复分支：`agent/prune-remote-collaboration-from-desktop`
- 当前发布目标：Windows NSIS `v1.0.0`
- 预期安装包：`Qingchen-AtlasCanvas-Setup-1.0.0.exe`
- 最新正式 Release run：`30939414022`
- 该运行已经通过：
  - Git LFS checkout
  - 固定 SHA、detached HEAD、发布命名目录门禁
  - Render/Atlas 无付费预检
  - Kimi/Wan 既有证据复用
  - Atlas adapter/schema/registry 测试
  - TypeScript、桌面打包、Updater 测试
  - NSIS 安装器生成
  - FFmpeg `xfade`、H.264、AAC、WebP 能力检查
  - FFprobe JSON 探测
  - RH/FAL Maker 前端 bundle 内容扫描
  - 桌面 Atlas post-build 文件检查
- 最新失败点：安装树验证器原本禁止整个 `/resources/backend-enc/collaboration/` 目录，但本地项目数据库和画布数据模型确实依赖其中的共享协议模块。
- 依赖扫描 Run：`30940122387`。确认必须保留：
  - `protocol`
  - `commonOperationProtocol`
  - `commonOperationAdapter`
  - `reviewLifecycle`
  - `runIntentAuthority`
  - `gatewaySecurity`
  - `executionPolicy`
- 桌面模式已经在运行时禁用远程协作路由和 gateway；当前分支正在做真实精确裁剪，而不是放宽安全门禁。
- 当前分支已修改：
  - 新增 `electron/desktopAtlasBackendProfile.cjs`
  - `electron/encrypt.cjs` 在桌面构建时跳过 8 个远程协作文件
  - `scripts/verify-desktop-atlas-install.cjs` 精确拒绝远程协作文件，同时允许本地核心协议模块
  - `tests/desktopAtlasPackaging.test.cjs` 增加回归测试
  - `.github/workflows/release-v1.0.0.yml` 纳入后端 profile 与加密脚本触发路径
- 当前待办：创建 PR、跑完整 CI、合并、启动新正式 Release run，继续完成 GitHub Release 上传和回下载 SHA-256 校验。
- **绝对禁止重复提交 Kimi 或 Wan 付费验收。后续正式发布只复用既有证据。**

## 1. 新会话接手规则

新会话必须按顺序执行：

1. 完整读取 `main` 分支的 `HANDOFF.md`。
2. 查询当前 `main` 最新 SHA，不得默认本文件中的历史 SHA 仍是最新。
3. 查询所有未关闭 PR，重点检查本文件记录的当前修复分支。
4. 查询最近正式 Release workflow、失败 job 和完整日志。
5. 只处理最新真实阻塞，不得推翻已经通过的修复。
6. 不得重新调用 Kimi/Wan 付费接口。
7. 产品代码必须走独立分支和 PR；临时诊断 PR 不得合并。
8. 每完成一个关键阶段，立即更新本文件。
9. 正式发布成功后，必须记录 Release URL、Tag、commit、资产名称、大小、SHA-256 和回下载验证结果。

新会话可直接发送：

```text
接手 https://github.com/qing20191723/T8-penguin-canvas 。先完整读取 main 分支 HANDOFF.md，再查询最新 main SHA、未关闭 PR 和最近 Release Actions。严格遵守禁止重复付费规则，直接继续代码修复、测试、PR、合并、正式发布，并在每个关键阶段更新 HANDOFF.md。
```

## 2. 项目目标与技术栈

目标：把 T8 无限画布稳定改造为清尘 Atlas Canvas，提供：

- Render Atlas-only Web 运行时
- Atlas 图片、视频、LLM、上传和异步任务轮询
- Windows Electron 桌面端
- 可验证、可自动更新、带 SHA-256 的 GitHub Release

技术栈：

- React 19、Vite 6、TypeScript 5.7、Tailwind CSS 3.4
- `@xyflow/react`、Zustand
- Express、`better-sqlite3`
- Electron 33.4.11、electron-builder 25.1.8、NSIS
- Node.js 22
- FFmpeg/FFprobe sidecar

关键 Atlas 路由：

- `GET /api/proxy/atlas/models`
- `POST /api/proxy/atlas/image`
- `POST /api/proxy/atlas/video`
- `GET /api/proxy/atlas/poll/:predictionId`

密钥边界：

- Render 只从 `ATLASCLOUD_API_KEY` 环境变量读取
- 桌面端只从本地安全存储或用户配置读取
- 禁止真实密钥进入仓库、前端 bundle、Actions 日志或本文件

## 3. 已完成付费验收——禁止重复

### Kimi K3

- 结果：`KIMI_K3_OK`
- 证据来源 Run：`30927107033`
- 总用量：160 tokens

### Wan 2.7 Spicy

- predictionId：`a239d599caf94acc98311972960be79f`
- MP4 字节数：`2060835`
- SHA-256：`fa5151e07dcc706d117a6a6453592a1fd03ba9aff60740e895f7d3f1ab921151`
- 历史 artifact ID：`8902255045`
- 最新正式运行复用 artifact ID：`8904552390`

除非用户明确要求并确认费用，否则任何新会话、PR 或 Release workflow 都不得重新提交这两个付费请求。

## 4. 已完成的重要修复

### Atlas 与 Render

- Atlas 官方模型目录和输入 schema 接入
- 图片、视频、LLM、上传和轮询适配器
- Render Atlas-only runtime
- Wan 长任务改为短提交 + 独立轮询
- Render `502/503/504` 或重启后恢复既有 predictionId
- `better-sqlite3` Web Node ABI 与 Electron ABI 分离重建

### Windows 发布链

- Windows Runner 命令调用修复
- 发布命名 worktree、detached HEAD、固定 SHA
- Electron 主入口：`electron/main.cjs`
- Git LFS 拉取真实 FFmpeg/FFprobe
- `better-sqlite3` Electron x64 rebuild
- NSIS 安装器已多次成功生成
- FFmpeg/FFprobe 实际能力验证
- 500 MiB 上限、密钥扫描、安装树扫描、SHA-256 和回下载验证框架

### RH/FAL Maker 泄漏

PR #68 已合并。根因是 `import.meta.env?.DEV` 无法可靠被 Vite 静态消除；已改为 `import.meta.env.DEV`，并加入六个禁用标记的 bundle 内容扫描。

验证：

- `Verify build` Run `30938093852`：成功
- `Verify production startup` Run `30938095879`：成功

## 5. 当前精确裁剪方案

桌面包必须保留本地数据模型依赖，但必须删除远程协作 transport。

统一清单位于：

```text
electron/desktopAtlasBackendProfile.cjs
```

桌面构建应排除：

```text
routes/collaboration.js
collaboration/abuseLimits.js
collaboration/auth.js
collaboration/gateway.js
collaboration/hostManagement.js
collaboration/publicExposure.js
collaboration/publicExposureStore.js
collaboration/textCrdt.js
```

必须继续保留的本地核心模块包括：

```text
collaboration/protocol.js
collaboration/commonOperationProtocol.js
collaboration/commonOperationAdapter.js
collaboration/reviewLifecycle.js
collaboration/runIntentAuthority.js
collaboration/gatewaySecurity.js
collaboration/executionPolicy.js
```

安全原则：

- 不允许粗暴删除整个 collaboration 目录，因为会破坏本地项目数据库和画布运行。
- 不允许取消安装树安全扫描。
- 应在加密阶段真实不生成远程文件，并由安装树验证器精确确认其不存在。

## 6. 正式发布门禁

不得删除或放宽：

- 固定 commit
- detached HEAD
- 发布命名目录
- Git LFS
- Atlas 无付费预检
- Kimi/Wan 证据复用
- TypeScript 和核心契约测试
- 前端密钥扫描
- RH/FAL Maker 内容扫描
- 远程协作文件精确扫描
- FFmpeg/FFprobe 能力验证
- 500 MiB 安装包上限
- `.sha256` sidecar
- GitHub Release 资产核对
- 从 Release 回下载并重新计算 SHA-256

重点文件：

```text
.github/workflows/release-v1.0.0.yml
electron/encrypt.cjs
electron/desktopAtlasBackendProfile.cjs
electron/_post_build.cjs
scripts/dist-release.cjs
scripts/verify-desktop-atlas-package.cjs
scripts/verify-desktop-atlas-install.cjs
scripts/verify-release-download.cjs
scripts/atlas-release-smoke.cjs
tests/desktopAtlasPackaging.test.cjs
```

## 7. 下一步执行清单

1. 审查当前分支 diff。
2. 创建产品 PR。
3. 等待并核对：
   - `Verify build`
   - `Verify production startup`
   - desktop packaging tests
   - TypeScript
   - desktop Atlas frontend build
4. 合并 PR。
5. 确认新正式 Release run 只产生一条。
6. 检查加密日志明确出现 8 个 `[skip]`。
7. 检查安装树中保留本地协议模块、删除远程协作模块。
8. 完成 NSIS、大小、密钥和 SHA-256 检查。
9. 创建或更新 `v1.0.0` Release。
10. 上传：
    - `Qingchen-AtlasCanvas-Setup-1.0.0.exe`
    - `Qingchen-AtlasCanvas-Setup-1.0.0.exe.blockmap`
    - `latest.yml`
    - `Qingchen-AtlasCanvas-Setup-1.0.0.exe.sha256`
11. 回下载并校验。
12. 将最终结果更新到本文件。

## 8. PR 与诊断规则

- 产品修改走独立 PR。
- 临时诊断 PR #49 只用于只读扫描或受控补丁生成，**永远不得合并**，用完必须关闭。
- Actions Token 对 workflow 文件写入可能受限，必要时由 GitHub 连接器直接提交。
- 不要创建重复正式 Release run；同一 SHA 优先重试失败 job。
- 不要为了通过 CI 删除安全门禁。

## 9. 文档更新规则

以下节点必须更新本文件：

- 新修复分支建立
- PR 创建
- CI 成功或失败
- PR 合并及新 main SHA
- 正式 Release run ID
- 新阻塞根因
- Tag/Release 创建
- 资产上传
- 回下载 SHA-256 通过

更新时必须保留第 1 节读取规则和第 3 节付费证据。
