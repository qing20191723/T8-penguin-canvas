# Atlas Canvas — 项目交接文档

## 项目概述

Fork 自 T8-penguin-canvas（MIT 协议），改造为 Atlas Cloud AI 画布。目标：部署到 Render.com，通过公网 URL 使用 Atlas Cloud 的 100+ AI 模型。

- **仓库**: https://github.com/qing20191723/T8-penguin-canvas
- **本地路径**: /mnt/d/atlas-canvas/
- **许可证**: MIT（T8 原作者 @T8mars）
- **目标部署**: Render.com（已绑信用卡，Free tier）

---

## 技术栈

```
前端: React 19 + Vite 6 + TypeScript 5.7 + Tailwind 3.4 + xyflow/react（画布引擎）
后端: Express (Node.js) + better-sqlite3
桌面: Electron（本项目不需要，仅 Web 部署）
状态管理: Zustand
```

---

## 目录结构（关键文件）

```
/mnt/d/atlas-canvas/
├── backend/                          # 后端 Express 服务
│   └── src/
│       ├── server.js                 # 主入口，注册路由（已修改 CORS + 注册 atlasProxy）
│       ├── config.js                 # 配置（端口 18766 等）
│       ├── routes/
│       │   ├── proxy.js              # 原有代理路由（RunningHub/贞贞工坊）
│       │   └── atlasProxy.js         # 【新增】Atlas Cloud 代理路由
│       └── services/                 # SQLite、文件管理
├── src/                              # 前端 React 代码
│   ├── App.tsx                       # 主入口
│   ├── components/
│   │   ├── ApiSettings.tsx           # 【已修改】API 设置面板（加了 Atlas key 字段）
│   │   ├── Canvas.tsx                # 画布主组件
│   │   └── CanvasToolbar.tsx         # 工具栏
│   ├── stores/
│   │   └── apiKeys.ts                # 【已修改】API Key store（加了 atlasApiKey）
│   ├── types/
│   │   └── canvas.ts                 # 【已修改】ApiSettings 类型（加了 atlasApiKey）
│   └── ...
├── package.json                      # 【已修改】改名 atlas-canvas
├── render.yaml                       # 【新增】Render 部署配置
├── railway.toml                      # 【新增】Railway 配置（废弃，Railway trial 过期）
└── PLAN.md                           # 规划文档
```

---

## 改动清单

### 已完成的改动（共 7 个文件）

1. **package.json** — 改名 atlas-canvas，author 改为 qing20191723
2. **backend/src/server.js** — CORS 改为允许所有来源 + 注册 `/api/proxy/atlas` 路由
3. **backend/src/routes/atlasProxy.js** — 新建，Atlas API 代理（图片/视频/模型列表/轮询）
4. **src/stores/apiKeys.ts** — 新增 `atlasApiKey`、`atlasBaseUrl` 字段
5. **src/types/canvas.ts** — ApiSettings 类型新增 `atlasApiKey`、`atlasBaseUrl`
6. **src/components/ApiSettings.tsx** — KeyField 类型、COMMON_KEYS、emptyMap()、emptyShow() 都加了 atlasApiKey
7. **render.yaml** — Render 部署配置

---

## 当前状态：Build 失败

**错误位置**: `src/components/ApiSettings.tsx` 第 278-285 行

**问题**：`emptyMap()` 和 `emptyShow()` 两个函数的对象字面量中，字段之间的**逗号缺失**。

**正确的代码**（这几行必须长这样）：
```typescript
const emptyMap = (): Record<KeyField, string> => ({
  zhenzhenApiKey: '', zhenzhenSd2ApiKey: '', rhApiKey: '', rhIntlApiKey: '', llmApiKey: '',
  gptImageApiKey: '', nanoBananaApiKey: '', mjApiKey: '', veoApiKey: '',
  soraApiKey: '', grokApiKey: '', seedanceApiKey: '', sunoApiKey: '', atlasApiKey: '',
});
const emptyShow = (): Record<KeyField, boolean> => ({
  zhenzhenApiKey: false, zhenzhenSd2ApiKey: false, rhApiKey: false, rhIntlApiKey: false, llmApiKey: false,
  gptImageApiKey: false, nanoBananaApiKey: false, mjApiKey: false, veoApiKey: false,
  soraApiKey: false, grokApiKey: false, seedanceApiKey: false, sunoApiKey: false, atlasApiKey: false,
});
```

**⚠️ 注意**：文件中可能残留字面上的 `***` 字符（三个星号），这些必须替换为正确的值：
- 字符串类型用 `''`（两个单引号）
- 布尔类型用 `false`

---

## Atlas Cloud API 接入

### API 端点（后端已实现）
```
GET  /api/proxy/atlas/models              → 获取模型列表
POST /api/proxy/atlas/image               → 提交图片生成（返回 predictionId）
POST /api/proxy/atlas/video               → 提交视频生成
GET  /api/proxy/atlas/poll/:predictionId  → 轮询结果
```

### API Key
- Key: `apikey-7132122750b64d7f9a342266c66912c7`
- 后端从环境变量 `ATLASCLOUD_API_KEY` 读取
- 前端设置面板支持手动输入（存储在 sessionStorage，提交到后端）

### 生成流程（异步）
```
前端 → POST /api/proxy/atlas/image {model, prompt, image_size}
     ← {predictionId}
前端 → GET /api/proxy/atlas/poll/{predictionId}（每 3 秒轮询）
     ← {status: "completed", src: "/files/output/xxx.png"}
```

---

## Render 部署配置

**render.yaml**:
```yaml
services:
  - type: web
    name: atlas-canvas
    env: node
    region: singapore
    plan: free
    buildCommand: npm install --include=dev && cd backend && npm install
    startCommand: cd backend && node src/server.js
    envVars:
      - key: ATLASCLOUD_API_KEY
        sync: false
      - key: HOST
        value: 0.0.0.0
      - key: PORT
        value: 10000
      - key: NODE_ENV
        value: production
```

**部署步骤**：
1. Build 通过后，推送到 GitHub main 分支
2. Render 自动检测并部署
3. 如果自动部署不触发，在 Render Dashboard → Manual Deploy → Deploy latest commit
4. 环境变量 ATLASCLOUD_API_KEY 需要在 Render Dashboard 手动添加

---

## 后续清理工作（阶段 5，可选）

删除 T8 原项目中不需要的模块（减小体积，加快构建）：
- RunningHub 相关代码
- Electron 打包相关
- Eagle API
- ComfyUI 节点
- 协作功能（collaboration）
- 植物大战僵尸主题

这些不影响核心功能，可以后续再做。

---

## 验证清单

Build 成功后验证：
1. 打开 `https://qingchen-atlascloud-canvas.onrender.com` 能看到画布
2. `GET /api/proxy/atlas/models` 返回 JSON 模型列表
3. `POST /api/proxy/atlas/image` 能提交图片生成并返回 predictionId
4. 轮询能拿到生成的图片
