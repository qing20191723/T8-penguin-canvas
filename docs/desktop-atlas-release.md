# 清尘无限画布 Atlas 桌面版发布与安装验收

## 固定产品边界

- 首版为 Windows 10/11 x64、NSIS 按用户安装，应用 ID 为 `com.qingchen.atlascanvas`。
- 版本线从 `v1.0.0` 开始，不移动或覆盖历史 `v2.7.3` Tag。
- 自动更新只读取 `qing20191723/T8-penguin-canvas` 的 GitHub Releases。
- 正式包不包含 Agent Skill/CLI、协作资源、RunningHub/FAL/ComfyUI/VibeX/飞书桥接、ParseHub/Figma/Photoshop 桥接或旧 Python 运行时压缩包。
- 保留 Electron、Atlas 桌面后端、前端、SQLite/Sharp 原生依赖及 FFmpeg/FFprobe。

## 用户数据与密钥

项目、画布、Run、素材、Atlas 目录缓存和加密密钥存储在 Electron `userData`。覆盖安装和默认卸载不删除该目录。Atlas 与自定义 Provider 密钥通过 Windows DPAPI/Electron `safeStorage` 保存；安全存储不可用时拒绝持久化，不写明文设置。

## 正式构建门禁

正式 NSIS、Tag 和 GitHub Release 只允许从最终合并的 `main` 完整 SHA 构建一次。执行者必须先取得用户对当前版本的单独明确发布授权，并设置脚本要求的逐版本审批值与固定 `T8_RELEASE_TARGET`。

发布链必须产出并校验：

- `Qingchen-AtlasCanvas-Setup-1.0.0.exe`
- 对应 `.blockmap`
- `latest.yml`
- 对应 `.exe.sha256`
- 固定源码 SHA 的 release provenance/recovery 记录

安装包硬上限为 500 MiB。`npm run desktop:package:verify` 只检查配置并报告可见资源体积；正式构建后的 `--artifact` 门禁以安装包实际字节数为准，超限立即停止并报告资源构成。

本项目首版不提供代码签名。Windows SmartScreen 可能显示“未知发布者”警告，用户需要核对 GitHub Release 来源和 `.sha256` 后选择“更多信息”继续安装。

## 干净 Windows 用户验收

1. 从用户仓库 Release 下载安装包并核对 SHA-256。
2. 在新的 Windows 10/11 x64 用户中按用户安装，启动后输入该用户自己的 Atlas API Key 并执行连接测试。
3. 确认图像、视频、LLM、音频和通用画布节点可新增；历史停用节点可查看但显示未启用且不能发出旧 Provider 请求。
4. 按批准的付费 smoke 清单各提交一次，验证原任务轮询、下载/文本校验、本地素材与 Run 关联。
5. 退出并重启，确认画布、Run、素材和“密钥已配置”状态保留。
6. 覆盖安装同版本，确认 `userData` 未被清除。
7. 在解包安装目录执行 `npm run desktop:install:verify -- --app-dir <win-unpacked>`；同时以只用于扫描的假密钥设置 `T8_SECRET_SCAN_VALUE`。
8. 从应用内检查更新，确认请求只指向 `qing20191723/T8-penguin-canvas`。

未生成与最终 `main` SHA 匹配的工件、未完成上述安装验收或未取得真实任务工件时，只能报告“代码/本地验证完成”。
