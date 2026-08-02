# Atlas 桌面运行模式

`desktop-atlas` 是 Windows/Electron 的单用户运行配置，与 Render 使用的
`atlas-only` 配置彼此独立。

## 能力边界

- 保留画布、项目、Run、素材库、上传与输出、本地图像处理、视频剪辑、
  FFmpeg、Sharp、SQLite，以及 Atlas / OpenAI-compatible 统一网关。
- Electron 主进程始终设置 `T8_DESKTOP_ATLAS_RUNTIME=1`。桌面前端构建使用
  `VITE_T8_DESKTOP_ATLAS_RUNTIME=1`。
- 协作网关、Yjs、Creator Agent、Agent Control 和旧 Provider 后台模块不会
  在此配置中加载。对应 HTTP 地址返回稳定的
  `desktop_atlas_runtime_disabled`，不会转发旧平台请求。
- 历史节点类型仍在节点 schema 中注册，以便旧画布渲染；它们不会出现在新增
  菜单或连线候选中。新的唯一视频入口是通用 `video` 节点，`seedance` 仅作
  历史文档兼容。

## 本地数据与密钥

Electron 正式包将数据库、画布、素材与设置放在 Electron `userData` 下。NSIS
覆盖安装沿用该目录，卸载器默认不删除用户数据。

Atlas 和自定义 Provider 的 API Key 不写入 `settings.json` 或 SQLite。正式桌面
运行时使用 Electron `safeStorage`（Windows DPAPI）加密后写入
`desktop-provider-secrets.enc.json`；后端读取时只在内存中解密。检测到旧版明文
设置后，程序先原子写入并验证安全存储，再原子清除设置文件中的明文字段。
`safeStorage` 不可用时返回 `desktop_secure_storage_unavailable`，不会回退为明文。

桌面与 Web 均只通过 `/api/settings` 返回 `configured`/掩码状态；
`/api/settings/raw` 在 `desktop-atlas` 中固定为 404。

## 开发验证

```powershell
npm run desktop-atlas:dev
npm run build:desktop-atlas
node --test backend/src/services/desktopAtlasRuntime.test.js tests/desktopSecretStore.test.cjs
node --test tests/desktopAtlasStartup.test.cjs
```

`npm run electron:desktop-atlas` 用于已有前端开发服务或构建产物时启动 Electron。
正式 NSIS、Tag 与 GitHub Release 不属于普通开发验证，必须取得单独发布授权。
