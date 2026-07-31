# Atlas Canvas — 项目交接

## 来源

Fork 自 https://github.com/T8mars/T8-penguin-canvas（MIT 协议，作者 @T8mars）

## 仓库

- GitHub: https://github.com/qing20191723/T8-penguin-canvas
- 本地: /mnt/d/atlas-canvas/

## 目标

将 T8 画布改造为 Atlas Cloud AI 画布，部署到 Render.com，公网 URL 访问。

---

## 技术

```
React 19 + Vite 6 + TypeScript 5.7 + Tailwind 3.4
画布引擎: xyflow/react
后端: Express (Node.js) + better-sqlite3
状态: Zustand
打包: Electron（本项目不用，仅 Web）
```

## 目录

```
/mnt/d/atlas-canvas/
├── backend/src/
│   ├── server.js        # Express 入口，路由注册
│   ├── config.js        # 端口 18766、路径等
│   └── routes/
│       ├── proxy.js      # 原有代理（RH/贞贞工坊）
│       └── atlasProxy.js # 新增 Atlas 代理
├── src/
│   ├── components/
│   │   └── ApiSettings.tsx  # API 设置面板
│   ├── stores/
│   │   └── apiKeys.ts       # API Key store
│   └── types/
│       └── canvas.ts        # ApiSettings 类型定义
├── render.yaml           # Render 部署配置
├── railway.toml          # Railway 配置（废弃）
└── PLAN.md               # 规划文档
```

## 改动过的文件

1. `package.json` — name 改为 atlas-canvas
2. `backend/src/server.js` — CORS 改为 allow all，注册 `/api/proxy/atlas`
3. `backend/src/routes/atlasProxy.js` — 新建，Atlas 图片/视频/模型列表/轮询代理
4. `src/stores/apiKeys.ts` — 新增 atlasApiKey、atlasBaseUrl
5. `src/types/canvas.ts` — ApiSettings 接口新增 atlasApiKey、atlasBaseUrl
6. `src/components/ApiSettings.tsx` — KeyField 联合类型、COMMON_KEYS 数组、emptyMap()、emptyShow() 新增 atlasApiKey

## Atlas API

- Base: https://api.atlascloud.ai
- Key: `apikey-7132122750b64d7f9a342266c66912c7`
- 后端路由:
  - GET /api/proxy/atlas/models
  - POST /api/proxy/atlas/image
  - POST /api/proxy/atlas/video
  - GET /api/proxy/atlas/poll/:predictionId

## Render 部署

- render.yaml 在根目录
- 环境变量: ATLASCLOUD_API_KEY, HOST=0.0.0.0, PORT=10000, NODE_ENV=production
- Build: npm install --include=dev && cd backend && npm install
- Start: cd backend && node src/server.js
- 公网 URL: https://qingchen-atlascloud-canvas.onrender.com

## Render Build 日志

最近一次失败日志:
```
src/components/ApiSettings.tsx(280,18): error TS1005: ',' expected.
src/components/ApiSettings.tsx(280,33): error TS1005: ',' expected.
src/components/ApiSettings.tsx(280,52): error TS1005: ',' expected.
src/components/ApiSettings.tsx(280,67): error TS1005: ',' expected.
src/components/ApiSettings.tsx(280,82): error TS1127: Invalid character.
```
