# Atlas Canvas — 项目交接

## 来源

Fork 自 https://github.com/T8mars/T8-penguin-canvas（MIT 协议，作者 @T8mars）。

## 仓库与目标

- GitHub: https://github.com/qing20191723/T8-penguin-canvas
- 本地工作区: `/mnt/d/atlas-canvas/`
- 目标: 将 T8 无限画布接入 Atlas Cloud，并作为 Node.js Web 服务部署到 Render。

## 技术栈

- React 19、Vite 6、TypeScript 5.7、Tailwind CSS 3.4
- 画布: `@xyflow/react`
- 后端: Express + `better-sqlite3`
- 状态: Zustand
- 桌面端: Electron 33（上游保留）
- Web 生产运行时: Node.js 22

## Atlas Cloud 接入

Atlas 已接入项目原有“扩展平台”架构，而不是仅提供独立代理路由。

主要文件:

- `backend/src/providers/atlas.js`: Atlas 图片、视频、媒体上传、异步任务轮询适配器
- `backend/src/providers/adapters.js`: 注册 `atlas` 协议
- `backend/src/providers/registry.js`: Atlas 默认平台与模型
- `src/utils/advancedProviders.ts`: 图像/视频节点的 Atlas 平台选择
- `src/components/ApiSettings.tsx`: Atlas 扩展平台设置界面
- `backend/src/routes/atlasProxy.js`: Atlas 模型列表与直接代理接口

API Key 仅通过 Render 环境变量 `ATLASCLOUD_API_KEY` 或本地扩展平台配置提供，禁止写入仓库。

直接代理路由:

- `GET /api/proxy/atlas/models`
- `POST /api/proxy/atlas/image`
- `POST /api/proxy/atlas/video`
- `GET /api/proxy/atlas/poll/:predictionId`

## Render 部署

- 服务名: `qingchen-atlascloud-canvas`
- 公网地址: https://qingchen-atlascloud-canvas.onrender.com
- 健康检查: `/api/status`
- Start: `cd backend && node src/renderServer.js`
- Build:

```bash
npm install --include=dev \
  && npm run build \
  && npm rebuild better-sqlite3 \
  && cd backend \
  && npm install
```

关键环境变量:

- `ATLASCLOUD_API_KEY`
- `HOST=0.0.0.0`
- `PORT=10000`
- `NODE_ENV=production`
- `T8PC_FRONTEND_DIST=../dist`
- `T8_FIGMA_BRIDGE_AUTOSTART=0`
- `ATLAS_ALLOWED_ORIGINS=https://qingchen-atlascloud-canvas.onrender.com`
- `T8_PUBLIC_ALLOWED_ORIGINS=https://qingchen-atlascloud-canvas.onrender.com`

## 已修复的启动根因

根目录的 `postinstall` 会执行 `electron-builder install-app-deps`，将 `better-sqlite3` 编译为 Electron 33 ABI。Render 使用普通 Node.js 22 启动后端，旧构建因此触发 `ERR_DLOPEN_FAILED` 并在监听端口前退出。

Web 构建现在会在前端编译完成后执行 `npm rebuild better-sqlite3`，把原生模块重新编译为当前 Node.js ABI。GitHub Actions 已使用与 Render 相同的构建和启动命令验证:

- TypeScript/Vite 构建通过
- Node.js 生产服务成功监听 `0.0.0.0:10000`
- `GET /api/status` 返回成功
- 首页返回有效 HTML

## CI 运行时

GitHub Actions 已升级为:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- 项目构建 Node.js 版本: 22

因此此前的“Node.js 20 已淘汰”警告已消除。该警告来自旧版 GitHub Action 的内部运行时，不是 Render 服务退出的根因。

## 当前状态

代码、构建和本地化生产启动验证均已通过。线上 Render 服务需要部署最新 `main` 后，再执行模型列表、图片提交和轮询的最终公网冒烟测试。
