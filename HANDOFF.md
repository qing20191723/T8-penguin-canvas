# Atlas Canvas — 项目交接与续作入口

> 本文件是新会话、Codex、其他智能体或人工维护者接手本仓库时的**第一读取入口**。任何关键修复、发布结果、阻塞点或验证证据发生变化后，都必须同步更新本文件。

## 0. 最新实时状态（2026-08-05）

- 交接文档已通过 PR #67 重构并合并到 `main`。
- RH/FAL 开发制作器生产 bundle 残留已通过 PR #68 修复并合并。
- 当前已确认的 `main` SHA：`0bd0f099877dcfe8ce791fc91209a532aac59684`。
- PR #68 `Verify build`：Run `30938093852`，全部通过。
- PR #68 `Verify production startup`：Run `30938095879`，通过。
- `build:desktop-atlas` 后的内容级扫描已确认下列开发标记均未进入桌面 bundle：
  - `RHToolboxMakerNode`
  - `RH工具箱制作器`
  - `rh-toolbox-maker`
  - `FalToolboxMakerNode`
  - `FAL应用制作工具`
  - `fal-toolbox-maker`
- 当前活动分支：`agent/release-trigger-and-handoff-sync`。
- 当前活动工作：扩展正式 release workflow 的路径触发范围，并同步交接状态。
- 该分支合并后应自动触发新的 Windows 正式 Release run。
- 下一步：锁定新的正式 Release run，复用已有 Kimi/Wan 证据，完成 NSIS、GitHub Release 上传、回下载和 SHA-256 校验。
- **仍然禁止重复调用 Kimi/Wan 付费验收。**

## 1. 新会话读取规则

新会话开始后，严格按以下顺序接手，不要先猜测，也不要重复执行昂贵操作：

1. 完整读取本文件 `HANDOFF.md`。
2. 读取仓库当前 `main` 的最新 SHA，确认本文件记录的 SHA 是否仍然有效。
3. 检查所有未关闭 PR、最近失败的 GitHub Actions，以及 `.github/workflows/release-v1.0.0.yml`。
4. 只在确认当前阻塞点后继续修改；不要重新推翻已经通过的修复。
5. **禁止重复提交已完成的 Kimi/Wan 付费验收。** 优先复用下面记录的证据、任务 ID 和 Actions artifact。
6. 每完成一个关键阶段，立即更新本文件中的“最新实时状态”“已完成”“待完成”“最新验证证据”和“下一步”。
7. 最终发布成功后，将 Release URL、安装包名称、大小、SHA-256、Tag、目标 commit 和回下载校验结果写入本文件。

新会话可直接向智能体发送：

```text
接手 https://github.com/qing20191723/T8-penguin-canvas 。先完整读取 main 分支的 HANDOFF.md，严格按其中读取规则、禁止重复付费规则和当前下一步继续工作。不要仅给建议，要直接检查代码、Actions、修复、测试、提交、合并并更新 HANDOFF.md。
```

## 2. 仓库与项目目标

- 仓库：`qing20191723/T8-penguin-canvas`
- 来源：Fork 自 `T8mars/T8-penguin-canvas`，MIT 协议
- Render 服务：`https://qingchen-atlascloud-canvas.onrender.com`
- 当前产品：清尘 Atlas Canvas / Qingchen AtlasCanvas
- 当前发布目标：Windows NSIS `v1.0.0`
- 桌面安装包预期名称：`Qingchen-AtlasCanvas-Setup-1.0.0.exe`
- 当前正式发布 workflow：`.github/workflows/release-v1.0.0.yml`
- 本地历史工作区：`/mnt/d/atlas-canvas/`（新会话不应假设该目录一定存在）

目标是将 T8 无限画布稳定接入 Atlas Cloud，提供：

- Render 上的 Atlas-only Web 运行时
- Atlas 图片、视频、LLM、上传、异步轮询能力
- Windows Electron 桌面端
- 可验证、可回下载、带 SHA-256 的 GitHub Release

## 3. 技术栈

- React 19、Vite 6、TypeScript 5.7、Tailwind CSS 3.4
- 画布：`@xyflow/react`
- 状态：Zustand
- 后端：Express + `better-sqlite3`
- 桌面端：Electron 33.4.11、electron-builder 25.1.8、NSIS
- Web/CI Node.js：22
- Windows 原生依赖：`better-sqlite3`
- 视频运行时：打包真实 FFmpeg 与 FFprobe sidecar

## 4. Atlas Cloud 接入边界

主要文件：

- `backend/src/providers/atlas.js`
- `backend/src/providers/atlasSchema.js`
- `backend/src/providers/adapters.js`
- `backend/src/providers/registry.js`
- `backend/src/routes/atlasProxy.js`
- `backend/src/routes/externalProviders.js`
- `src/utils/advancedProviders.ts`
- `src/components/ApiSettings.tsx`
- `src/components/AtlasModelPicker.tsx`

直接代理路由：

- `GET /api/proxy/atlas/models`
- `POST /api/proxy/atlas/image`
- `POST /api/proxy/atlas/video`
- `GET /api/proxy/atlas/poll/:predictionId`

API Key 只允许来自：

- Render 环境变量 `ATLASCLOUD_API_KEY`
- 本地桌面安全存储或用户配置

禁止把任何真实密钥写入仓库、前端 bundle、Actions 日志或交接文档。

## 5. Render 生产部署

- 服务名：`qingchen-atlascloud-canvas`
- 公网地址：`https://qingchen-atlascloud-canvas.onrender.com`
- 健康检查：`GET /api/status`
- Start：`cd backend && node src/renderServer.js`
- 当前构建逻辑：

```bash
npm install --include=dev \
  && npm run build \
  && npm rebuild better-sqlite3 \
  && cd backend \
  && npm install
```

关键环境变量：

- `ATLASCLOUD_API_KEY`
- `HOST=0.0.0.0`
- `PORT=10000`
- `NODE_ENV=production`
- `T8PC_FRONTEND_DIST=../dist`
- `T8_FIGMA_BRIDGE_AUTOSTART=0`
- `ATLAS_ALLOWED_ORIGINS=https://qingchen-atlascloud-canvas.onrender.com`
- `T8_PUBLIC_ALLOWED_ORIGINS=https://qingchen-atlascloud-canvas.onrender.com`

已解决 Render 上 `better-sqlite3` Electron ABI 与 Node.js 22 ABI 冲突：Web 构建后必须重新执行 `npm rebuild better-sqlite3`。

## 6. 当前基线与关键历史定位

- 交接文档重构前基线：`2ed132e436c263f3b60f34786f2dc36b3d5c2106`
- RH/FAL bundle 修复合并后基线：`0bd0f099877dcfe8ce791fc91209a532aac59684`
- 最近失败的正式发布运行：GitHub Actions Run `30933706609`
- 最近失败的正式发布结果：安装器已生成，但当时被 RH Maker bundle 安全检查拦截
- 最近完成的产品修复 PR：`#68`
- 最近交接文档 PR：`#67`
- 临时诊断 PR：`#49`，不得合并

新会话必须重新读取最新 `main` SHA；本节 SHA 用于历史定位，不得盲目假设仍是最新。

## 7. 已完成工作

### 7.1 Atlas 与 Render

- Atlas 模型目录、官方输入 schema、动态参数映射已接入。
- Atlas 图片、视频、LLM、上传与异步轮询适配器已完成。
- Render Atlas-only 运行时可正常启动。
- `/api/status`、Atlas provider dry-run、模型列表预检已通过。
- Wan 长任务已从同步长连接改为：短请求提交任务 + 独立 GET 轮询。
- Render 重启或临时 `502/503/504` 时可以恢复既有 Wan predictionId，不重复提交任务。

### 7.2 付费验收——已完成，禁止重复

Kimi K3：

- 已成功返回：`KIMI_K3_OK`
- 证据来源：正式运行 `30927107033`
- 总用量：160 tokens

Wan 2.7 Spicy：

- 已成功提交并完成
- predictionId：`a239d599caf94acc98311972960be79f`
- MP4 字节数：`2060835`
- SHA-256：`fa5151e07dcc706d117a6a6453592a1fd03ba9aff60740e895f7d3f1ab921151`
- Actions artifact：`atlas-paid-smoke-v1.0.0-2ed132e436c263f3b60f34786f2dc36b3d5c2106`
- Artifact ID：`8902255045`

后续正式发布脚本应复用上述证据，不应再次调用 Kimi 或 Wan，除非用户明确要求重新验收且确认费用。

### 7.3 Windows 发布链已修复部分

- 修复 Windows Runner 执行 electron-builder 的问题。
- 正式发布使用固定 SHA、发布命名目录和 detached HEAD。
- 补齐 `package.json` 顶层 Electron 主入口：`electron/main.cjs`。
- 正式 checkout 已启用 `lfs: true`。
- Git LFS 中真实 FFmpeg/FFprobe 已在 Actions 中成功下载。
- `better-sqlite3` Electron x64 rebuild 已通过。
- electron-builder 已成功生成过：

```text
dist_electron/Qingchen-AtlasCanvas-Setup-1.0.0.exe
dist_electron/Qingchen-AtlasCanvas-Setup-1.0.0.exe.blockmap
latest.yml
```

- 打包后的真实 FFmpeg 已通过：
  - `xfade` 高质量转场能力
  - H.264 编码
  - AAC 编码
  - WebP 预览编码
- 打包后的 FFprobe JSON 探测已通过。
- 桌面 Atlas 加密后端、前端、shared 清单、`better_sqlite3.node` 均通过 post-build 文件检查。
- 桌面 Atlas 专用 post-build profile 与安装树禁用资源扫描已经接入。

### 7.4 RH/FAL 开发制作器 bundle 泄漏已修复

根因：多处使用 `import.meta.env?.DEV`，Vite 无法稳定完成编译期替换和死代码消除，导致开发节点名称、中文标签、节点类型和默认数据进入生产主 bundle。

已修复位置：

- `src/components/Canvas.tsx`
- `src/config/nodeRegistry.ts`
- `src/config/portTypes.ts`
- `src/utils/nodePlacement.ts`
- `src/config/atlasOnlyRuntime.ts`

修复内容：

- Maker 相关 DEV guard 改为 `import.meta.env.DEV`
- Maker 类型只在 DEV 模式加入隐藏集合
- `scripts/verify-desktop-atlas-package.cjs --frontend` 增加 bundle 内容级扫描
- `tests/desktopAtlasPackaging.test.cjs` 增加：
  - dev-only marker 拒绝测试
  - 禁止回退为 `import.meta.env?.DEV` 的回归测试

验证结果：

- PR #68 `Verify build` Run `30938093852`：全部通过
- PR #68 `Verify production startup` Run `30938095879`：通过
- 普通 Vite 生产构建：通过
- 桌面 Atlas Vite 生产构建：通过
- 六个 RH/FAL Maker 禁用标记内容扫描：通过

### 7.5 已通过的主要测试

- Atlas adapter/schema/registry
- Atlas searchable model selector
- 桌面 Atlas runtime 与安全存储
- 桌面 Atlas packaging 与 updater policy
- Web credential boundary
- memory diagnostics
- generated feature artifacts
- TypeScript `tsc --noEmit`
- 普通 Vite production build
- desktop Atlas production build
- Render 风格生产启动
- Kimi/Wan 已完成证据复用

## 8. 当前待完成工作

当前代码级 RH/FAL bundle 阻塞已经解决。剩余工作集中在正式发布：

1. 合并 `agent/release-trigger-and-handoff-sync`。
2. 确认 `.github/workflows/release-v1.0.0.yml` 自动触发新的 push 型正式运行。
3. 锁定该运行的 Run ID 和目标 SHA。
4. 确认正式发布复用 Kimi/Wan 证据，不重新付费。
5. 完成正式 Windows 构建：
   - LFS checkout
   - detached HEAD 与固定 SHA
   - native rebuild
   - electron-builder NSIS
   - post-build 文件检查
   - RH/FAL bundle 内容扫描
   - installed-tree 禁用资源扫描
   - 500 MiB 上限
   - 密钥扫描
6. 创建或更新 Tag/Release：`v1.0.0`。
7. 上传：
   - `Qingchen-AtlasCanvas-Setup-1.0.0.exe`
   - `.exe.blockmap`
   - `latest.yml`
   - `.exe.sha256`
8. 从 GitHub Release 回下载安装包并验证 SHA-256。
9. 检查 updater 元数据与目标 commit。
10. 将最终 Release URL、文件大小、SHA-256、Tag、commit、回下载结果写回本文件。

## 9. 发布脚本与安全约束

重点文件：

- `.github/workflows/release-v1.0.0.yml`
- `scripts/dist-release.cjs`
- `scripts/verify-desktop-atlas-package.cjs`
- `scripts/verify-desktop-atlas-install.cjs`
- `scripts/verify-release-download.cjs`
- `scripts/atlas-release-smoke.cjs`
- `electron/_post_build.cjs`
- `package.json`

不可绕过的门禁：

- 固定 release commit
- detached HEAD
- 发布命名目录
- Git LFS 拉取真实 sidecar
- 500 MiB 安装包上限
- 前端和安装树密钥扫描
- 禁止 RH/FAL Maker、旧平台桥接或禁用资源进入桌面包
- FFmpeg/FFprobe 实际能力验证
- SHA-256 sidecar
- GitHub Release 回下载验证

不得为了“让 CI 变绿”而删除或放宽这些门禁。应修复真实打包内容或发布逻辑。

## 10. 已知发布行为

在非 Tag push 上，electron-builder 会生成本地安装器，但可能提示：

```text
release doesn't exist and not created because publish is not always and build is not on tag
```

`dist-release.cjs` 后续应负责创建或补齐正式 Release/Tag/资产。不要把该提示误判为主要失败；必须继续看 post-build、release 创建和回下载阶段的最终日志。

## 11. 分支、PR 与临时诊断规则

- 产品修改必须走独立分支和 PR，审查 diff 后再合并。
- 临时只读或补丁诊断 workflow/PR 不得合并进 `main`，用完立即关闭。
- 不要创建会重复触发付费 smoke 的额外发布任务。
- 正式 workflow 同一 SHA 只保留一条运行；若仅重试确定的非付费失败任务，应优先 rerun failed job。
- Actions Token 对 `.github/workflows/*` 的写入可能受限；必要时由 GitHub 连接器单独提交 workflow 变更。

## 12. 当前下一步

立即执行：

1. 审查并合并 `agent/release-trigger-and-handoff-sync`。
2. 获取新正式 Release run ID。
3. 跟踪到 NSIS、Release 上传和回下载校验全部完成。
4. 若失败，读取最新 job 日志，仅修复新的真实阻塞，不回退已通过修复。
5. 更新本文件的“最新实时状态”和最终发布信息。
