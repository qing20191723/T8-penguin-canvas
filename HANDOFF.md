# Atlas Canvas — 项目交接与续作入口

> **本文件是任何新会话、Codex、其他智能体或人工维护者接手本项目时必须完整读取的第一入口。**
>
> 每次关键修复、PR 合并、GitHub Actions 结果、发布状态或阻塞点发生变化后，都必须同步更新本文件。禁止只在聊天中记录进度而不写回仓库。

## 0. 最新实时状态（2026-08-05）

### 当前结论

- Windows 正式版本 **`v1.0.0` 已发布成功**。
- Release 页面：`https://github.com/qing20191723/T8-penguin-canvas/releases/tag/v1.0.0`
- Release 源 commit：`dec91a12782da024d9b7476cdd612b0c3c569543`
- 正式发布 Actions Run：`30941254079`
- Release job：`92099884308`
- Run 结果：`success`
- Release 状态：公开、非 Draft、非 Prerelease、Latest Release。
- GitHub Release 已完成完整回下载校验，不只是检查元数据。
- Kimi K3 与 Wan 2.7 Spicy 均复用历史验收证据，本轮没有重复提交付费任务。

### 已发布资产

| 资产 | 大小 | GitHub SHA-256 digest |
|---|---:|---|
| `Qingchen-AtlasCanvas-Setup-1.0.0.exe` | `427,494,388` bytes（约 407.7 MiB） | `63ccf4d1e29541a6ade972a9e60443176ba678c4a849226df77d964b85d14924` |
| `Qingchen-AtlasCanvas-Setup-1.0.0.exe.blockmap` | `445,493` bytes | `9993ae23f1f742fbe4ac674dc05cd4ea4f0c8e95c6c71f576c1c87f85eb13fed` |
| `latest.yml` | `369` bytes | `bac171c35bf5b7c6efb45e4bbfc64a171c8b64a682a78cec1f2b7bdac47d4034` |
| `Qingchen-AtlasCanvas-Setup-1.0.0.exe.sha256` | `103` bytes | `0173bca4ff944ee7043e2ba25ee87707595cc7d75f47ba47efc9cc6431bd9269` |

安装包直达地址：

```text
https://github.com/qing20191723/T8-penguin-canvas/releases/download/v1.0.0/Qingchen-AtlasCanvas-Setup-1.0.0.exe
```

校验文件直达地址：

```text
https://github.com/qing20191723/T8-penguin-canvas/releases/download/v1.0.0/Qingchen-AtlasCanvas-Setup-1.0.0.exe.sha256
```

### 最终验证结果

正式 Run `30941254079` 已通过：

- Git LFS 拉取真实 FFmpeg/FFprobe
- 固定 release commit
- detached HEAD
- 发布命名 worktree
- Render/Atlas 无付费预检
- Atlas adapter、schema、registry 测试
- 桌面打包与 updater 测试
- TypeScript `tsc --noEmit`
- Creative capability artifact 同步检查
- Kimi/Wan 既有证据复用
- Electron `better-sqlite3` x64 rebuild
- 桌面 Atlas Vite 生产构建
- RH/FAL Maker 六个禁用标记内容扫描
- 8 个远程协作 transport 文件在加密阶段真实跳过
- 本地数据库必需的协议模块继续保留
- FFmpeg `xfade` 转场能力
- FFmpeg H.264、AAC、WebP 能力
- FFprobe JSON 探测
- NSIS 安装器生成
- post-build 文件和安全检查
- 安装树精确禁用资源扫描，共检查 1,303 个文件
- 500 MiB 安装包上限
- SHA-256 sidecar 生成
- GitHub Release 资产上传
- Release 资产大小和 GitHub digest 校验
- 从 Release 完整重新下载安装包
- 下载后字节与 SHA-256 再校验
- `v1.0.0` 被确认为 Latest Release

## 1. 新会话接手规则

新会话必须严格按以下顺序执行，不得跳过：

1. 完整读取 `main` 分支的 `HANDOFF.md`。
2. 查询仓库当前 `main` 最新 SHA。不要默认本文件中的 Release 源 commit 就是最新 `main`。
3. 查询所有未关闭 PR，确认是否有后续修复或文档同步正在进行。
4. 查询最近相关 GitHub Actions，区分：
   - 普通 CI；
   - Render 启动检查；
   - 正式 Release workflow；
   - 临时只读诊断 workflow。
5. 只处理最新真实阻塞，不得推翻已经通过并发布的修复。
6. **禁止重新调用 Kimi K3 或 Wan 2.7 Spicy 付费验收。**
7. 产品代码修改必须使用独立分支和 PR，审查 diff、通过 CI 后再合并。
8. 临时诊断 PR 不得合并进 `main`，使用后必须关闭。
9. 每完成一个关键阶段，立即更新 `HANDOFF.md`。
10. 新版本发布后，必须记录 Tag、commit、Run ID、Release URL、资产大小、SHA-256 和回下载结果。

新会话推荐直接发送：

```text
接手 https://github.com/qing20191723/T8-penguin-canvas 。先完整读取 main 分支 HANDOFF.md，再查询最新 main SHA、未关闭 PR、最近 CI 和 Release Actions。严格遵守禁止重复付费规则。不要只给建议，直接检查代码、修复、测试、提交 PR、合并，并在每个关键阶段更新 HANDOFF.md。
```

## 2. 仓库、服务与项目目标

- 仓库：`qing20191723/T8-penguin-canvas`
- 上游来源：`T8mars/T8-penguin-canvas`
- Render：`https://qingchen-atlascloud-canvas.onrender.com`
- 产品名：清尘 Atlas Canvas / Qingchen AtlasCanvas
- 当前正式版本：`v1.0.0`
- 当前 Windows 安装包：`Qingchen-AtlasCanvas-Setup-1.0.0.exe`
- 正式发布 workflow：`.github/workflows/release-v1.0.0.yml`

项目目标：

- Render Atlas-only Web 运行时
- Atlas 图片、视频、LLM、上传和异步轮询
- Windows Electron 桌面端
- 可自动更新的 GitHub Release
- 可审计、可回下载、带 SHA-256 的正式安装包

## 3. 技术栈

- React 19
- Vite 6
- TypeScript 5.7
- Tailwind CSS 3.4
- `@xyflow/react`
- Zustand
- Express
- `better-sqlite3`
- Electron 33.4.11
- electron-builder 25.1.8
- NSIS
- Node.js 22
- FFmpeg/FFprobe sidecar

Atlas 关键路由：

```text
GET  /api/proxy/atlas/models
POST /api/proxy/atlas/image
POST /api/proxy/atlas/video
GET  /api/proxy/atlas/poll/:predictionId
```

密钥边界：

- Render 只从环境变量 `ATLASCLOUD_API_KEY` 读取。
- 桌面端只从本地安全存储或用户配置读取。
- 禁止真实密钥进入仓库、前端 bundle、Actions 日志或本文件。

## 4. 已完成的付费验收——绝对禁止重复

### Kimi K3

- 结果：`KIMI_K3_OK`
- 原始证据 Run：`30927107033`
- 总用量：160 tokens

### Wan 2.7 Spicy

- predictionId：`a239d599caf94acc98311972960be79f`
- MP4 字节数：`2,060,835`
- MP4 SHA-256：`fa5151e07dcc706d117a6a6453592a1fd03ba9aff60740e895f7d3f1ab921151`
- 历史 artifact ID：`8902255045`
- 最终正式 Run 证据 artifact ID：`8905281249`
- 最终 artifact ZIP digest：`0d991a9901e25bfd6cd7781c0b0789f0c9ece08fde7154e5df4b63e76616d0f5`

除非用户明确要求重新验收并确认费用，否则任何新会话、PR 或 Release workflow 都不得重新提交这两个请求。

## 5. 已完成的重要修复

### Atlas 与 Render

- 接入 Atlas 官方模型目录和 Input schema。
- 完成图片、视频、LLM、上传和异步轮询适配器。
- Render 使用 Atlas-only runtime。
- Wan 长任务改为“短提交 + 独立轮询”。
- Render `502/503/504` 或重启后恢复既有 predictionId，避免重复收费。
- 解决 `better-sqlite3` Web Node ABI 与 Electron ABI 冲突。

### Windows 发布链

- 修复 Windows Runner electron-builder 调用方式。
- 发布使用固定 SHA、detached HEAD 和发布命名 worktree。
- 补齐 Electron 主入口：`electron/main.cjs`。
- 启用 Git LFS，拉取真实 FFmpeg/FFprobe。
- 完成 `better-sqlite3` Electron x64 rebuild。
- 建立 500 MiB 上限、密钥扫描、安装树扫描、SHA-256 和回下载验证。
- 发布脚本能够创建 Draft、上传资产、完整下载验证，再公开为正式 Release。

### RH/FAL Maker 生产 bundle 泄漏

- PR #68 已合并。
- 根因：使用 `import.meta.env?.DEV` 导致 Vite 无法可靠完成静态死代码消除。
- 修复：改为 `import.meta.env.DEV`，并增加六个禁用标记的内容级扫描。
- 验证：
  - Verify build Run `30938093852`：成功
  - Verify production startup Run `30938095879`：成功

### 远程协作模块精确裁剪

- PR #70 已合并。
- 统一 profile：`electron/desktopAtlasBackendProfile.cjs`
- 桌面加密阶段真实跳过以下 8 个远程协作文件：

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

保留本地项目数据库和画布所需模块：

```text
collaboration/protocol.js
collaboration/commonOperationProtocol.js
collaboration/commonOperationAdapter.js
collaboration/reviewLifecycle.js
collaboration/runIntentAuthority.js
collaboration/gatewaySecurity.js
collaboration/executionPolicy.js
```

正式发布日志确认：

```text
[encrypt] backend src files: 169 (8 release-excluded)
```

随后逐条输出了 8 个 `[skip]`，并成功加密保留的本地协议模块。

## 6. 发布安全门禁

后续版本不得删除或放宽：

- 固定 release commit
- detached HEAD
- 发布命名 worktree
- Git LFS
- Atlas 无付费预检
- Kimi/Wan 历史证据复用
- TypeScript 和核心契约测试
- 前端密钥扫描
- RH/FAL Maker 内容扫描
- 远程协作文件精确扫描
- FFmpeg/FFprobe 能力验证
- 500 MiB 安装包上限
- SHA-256 sidecar
- GitHub Release 资产核对
- Release 全量回下载验证

关键文件：

```text
.github/workflows/release-v1.0.0.yml
electron/main.cjs
electron/encrypt.cjs
electron/desktopAtlasBackendProfile.cjs
electron/_post_build.cjs
scripts/dist-release.cjs
scripts/release-github.cjs
scripts/verify-github-release.cjs
scripts/verify-desktop-atlas-package.cjs
scripts/verify-desktop-atlas-install.cjs
scripts/atlas-release-smoke.cjs
tests/desktopAtlasPackaging.test.cjs
```

## 7. 当前剩余工作：发布后验收与商用加固

`v1.0.0` 的 CI 发布链已经完成。下一阶段不是继续修发布脚本，而是做真实用户环境验收与商用加固。

按优先级建议执行：

1. **干净 Windows 实机安装验收**
   - 下载正式 Release 安装包；
   - 验证安装、启动、卸载；
   - 验证首次启动数据库创建；
   - 验证 Atlas 模型列表；
   - 验证图片节点、视频节点和 LLM 节点；
   - 验证项目保存、重启恢复和本地资产读取。
2. **桌面启动 smoke 自动化**
   - 当前 CI 验证了安装树和包内容，但没有在 Windows Runner 中真正启动安装后的 GUI 并检查后端 ready 状态；
   - 建议增加 headless/hidden-window 启动 smoke 和本地 API 健康检查。
3. **代码签名**
   - 当前日志显示 `no signing info identified`；
   - 安装包没有 Windows Authenticode 签名，可能触发 SmartScreen 警告；
   - 商用公开分发前应配置可信代码签名证书与签名验证门禁。
4. **应用图标与品牌资源**
   - 当前日志显示使用默认 Electron 图标；
   - 应配置正式 `.ico`、安装器图标、卸载图标和应用品牌元数据。
5. **依赖安全审计**
   - `npm ci` 当前报告 28 个漏洞：2 low、1 moderate、22 high、3 critical；
   - 不应直接使用 `npm audit fix --force`；
   - 需要区分生产依赖、开发依赖、可达性和升级破坏范围，逐项建立修复 PR。
6. **不可变 Release 策略**
   - 当前验证输出：`GitHub immutable: no (publisher-level no-overwrite only)`；
   - 发布脚本实施了应用层禁止覆盖，但仓库未启用 GitHub Immutable Releases；
   - 可评估启用仓库级不可变 Release。
7. **自动更新跨版本验收**
   - `latest.yml`、blockmap 和 updater 合约已验证；
   - 仍需在下一个版本发布时完成 `v1.0.0 → v1.0.1` 的真实升级、下载、安装和回滚测试。

## 8. PR 与临时诊断规则

- 产品修改必须走独立 PR。
- 临时诊断 PR #49 只允许用于只读扫描或受控诊断，**永远不得合并**。
- 使用临时诊断 PR 后必须关闭。
- 不要为同一 SHA 创建重复正式 Release run。
- 同一 SHA 仅遇到基础设施临时故障时，优先重试失败 job。
- 不要为了让 CI 通过而删除真实安全门禁。
- Actions Token 对 `.github/workflows/*` 写入可能受限，必要时由 GitHub 连接器单独提交。

## 9. 文档更新规则

以下节点必须更新本文件：

- 新修复分支建立
- PR 创建
- CI 成功或失败
- PR 合并和新 main SHA
- 新 Release Run ID
- 新阻塞根因
- 新 Tag/Release 创建
- 资产上传
- 回下载校验
- 实机安装验收
- 代码签名和应用图标完成
- 依赖安全审计结果

更新时必须保留：

- 第 1 节新会话接手规则；
- 第 4 节付费验收与禁止重复规则；
- 已发布版本的 Release URL、commit、资产和 SHA-256。
