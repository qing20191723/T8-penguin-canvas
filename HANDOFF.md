# Atlas Canvas — 项目交接与续作入口

> 本文件是新会话、Codex、其他智能体或人工维护者接手本仓库时的**第一读取入口**。任何关键修复、发布结果、阻塞点或验证证据发生变化后，都必须同步更新本文件。

## 1. 新会话读取规则

新会话开始后，严格按以下顺序接手，不要先猜测，也不要重复执行昂贵操作：

1. 完整读取本文件 `HANDOFF.md`。
2. 读取仓库当前 `main` 的最新 SHA，确认本文件记录的 SHA 是否仍然有效。
3. 检查所有未关闭 PR、最近失败的 GitHub Actions，以及 `.github/workflows/release-v1.0.0.yml`。
4. 只在确认当前阻塞点后继续修改；不要重新推翻已经通过的修复。
5. **禁止重复提交已完成的 Kimi/Wan 付费验收。** 优先复用下面记录的证据、任务 ID 和 Actions artifact。
6. 每完成一个关键阶段，立即更新本文件中的“当前状态”“已完成”“待完成”“最新验证证据”和“下一步”。
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

## 6. 当前基线

- 本文件首次重写前的 `main` SHA：`2ed132e436c263f3b60f34786f2dc36b3d5c2106`
- 最近正式发布运行：GitHub Actions Run `30933706609`
- 最近正式发布结果：失败于 post-build 安全检查，安装器本体已经成功生成
- 最近只读诊断 PR：`#49`，已经关闭且不得合并
- 最近完成的产品修复 PR：`#65`，已合并

新会话必须重新读取最新 `main` SHA；本节 SHA 只作为历史定位点。

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
- electron-builder 已成功生成：

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

### 7.4 已通过的测试

最近正式运行已通过：

- Atlas adapter/schema/registry：25 项
- 桌面 Atlas 打包策略：3 项
- Electron updater：4 项
- TypeScript `tsc --noEmit`
- Creative capability artifact 同步检查
- Render/Atlas 无付费预检
- Kimi/Wan 已完成证据复用

## 8. 当前唯一明确阻塞点

正式运行 `30933706609` 在 `Build, seal and publish Windows release` 的 post-build 阶段失败：

```text
SECURITY RH toolbox maker frontend code leaked into packaged assets:
resources/frontend/assets/index-DDbtuV5v.js
```

注意：

- NSIS 安装器已经生成成功。
- FFmpeg、FFprobe 和原生依赖已经通过。
- 当前不是 Atlas、Render、Kimi、Wan、LFS、Electron 入口或 NSIS 本体问题。
- 当前必须真正从桌面生产 bundle 中移除 RH Toolbox Maker 开发代码，不能放宽安全扫描。

诊断扫描确认以下开发态标记仍进入源码构建图：

- `RHToolboxMakerNode`
- `RH工具箱制作器`
- `rh-toolbox-maker`

主要位置：

- `src/config/nodeRegistry.ts`
- `src/components/Canvas.tsx`
- `src/config/portTypes.ts`
- `src/utils/nodePlacement.ts`
- `src/config/atlasOnlyRuntime.ts`
- `src/types/canvas.ts`（仅类型声明是否会进入 bundle需单独判断）

根因判断：多处使用 `import.meta.env?.DEV`。Vite 生产构建最可靠的静态替换与死代码消除目标是 `import.meta.env.DEV`；可选链形式使部分字符串和注册对象保留在主 bundle。

已确认的示例：

```ts
const DEV_NODE_REGISTRY: NodeMeta[] = import.meta.env?.DEV && !ATLAS_LIGHTWEIGHT_RUNTIME
  ? [
      { type: 'rh-toolbox-maker', label: 'RH工具箱制作器', ... },
      { type: 'fal-toolbox-maker', ... },
    ]
  : [];
```

以及 `Canvas.tsx` 中的开发节点模块常量、lazy import、nodeTypes 注册和默认节点数据。

## 9. 接下来需要完成的工作

按优先顺序执行：

1. 在独立修复分支中，将 RH/FAL Maker 的开发态门禁改为可被 Vite 静态消除的形式。
2. 不只替换一个表达式；必须审查所有含 Maker 字符串、注册、默认值、端口、尺寸和隐藏列表的路径。
3. 保持开发环境中 Maker 功能可用；只从生产和桌面 Atlas bundle 中删除。
4. 增加或更新回归测试，至少验证：
   - 开发源码仍存在 Maker 能力；
   - `build:desktop-atlas` 的输出中不存在三个禁用标记；
   - 普通生产构建策略没有意外破坏其他节点。
5. 运行 PR CI：
   - Atlas adapter/schema tests
   - desktop packaging tests
   - Electron updater tests
   - type-check
   - Vite production build
   - desktop Atlas production build
   - 前端密钥扫描
6. 合并修复后，确认自动触发正式 `Release v1.0.0` workflow。
7. 正式 release 中核对：
   - post-build 安全检查通过；
   - installed-tree 检查通过；
   - installer 小于 500 MiB；
   - 生成 `.sha256`；
   - 创建/更新 GitHub Release `v1.0.0`；
   - 上传 exe、blockmap、latest.yml、sha256；
   - 回下载并校验 SHA-256；
   - updater 元数据指向正确安装包。
8. 发布成功后更新本文件并记录最终 Release URL 和文件信息。

## 10. 发布脚本与安全约束

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

## 11. 已知发布行为

在非 Tag push 上，electron-builder 会生成本地安装器，但可能提示：

```text
release doesn't exist and not created because publish is not always and build is not on tag
```

`dist-release.cjs` 后续应负责创建或补齐正式 Release/Tag/资产。不要把该提示误判为当前主要失败；最近一次运行实际先被 RH Maker 安全检查阻止。

## 12. 分支、PR 与临时诊断规则

- 产品修改必须走独立分支和 PR，审查 diff 后再合并。
- 临时只读诊断 workflow/PR 不得合并进 `main`，用完立即关闭。
- 不要创建会重复触发付费 smoke 的额外发布任务。
- 正式 workflow 同一 SHA 只保留一条运行；若仅重试确定的非付费失败任务，应优先 rerun failed job。
- Actions Token 对 `.github/workflows/*` 的写入可能受限；必要时由 GitHub 连接器单独提交 workflow 变更。

## 13. 当前工作约定

从现在起，每个关键阶段都要同步本文件：

- 文档建立完成
- RH Maker 修复分支建立
- PR 创建
- CI 结果
- PR 合并和新 main SHA
- 正式 Release run ID
- 发布成功或新阻塞点

更新时不得删除历史付费证据和禁止重复付费规则。

## 14. 当前下一步

立即执行：

1. 建立 RH Maker tree-shaking 修复分支。
2. 完整读取并修改 `nodeRegistry.ts`、`Canvas.tsx`、`portTypes.ts`、`nodePlacement.ts`、`atlasOnlyRuntime.ts` 相关上下文。
3. 将生产 bundle 残留检查加入可重复测试。
4. 构建、测试、PR、合并。
5. 重跑正式发布，并将结果更新到本文件。
