# Atlas 桌面版模型目录与音频

## 动态目录

- `/api/proxy/atlas/models` 只接收 Atlas 官方目录中公开且指向
  `https://static.atlascloud.ai/model/schema/` 的模型。
- 响应保留原有 `models/items/total` 字段，并增加目录版本、摘要、获取时间和
  `live/cache/fallback` 来源。
- 最后一次成功目录原子缓存在 Electron `userData`。没有缓存时只显示经过 fixture
  验证的推荐模型，并明确标记“目录降级”。模型总数来自官方实时目录，不硬编码。

## 模型选择

图像、视频、LLM 和音频节点使用可搜索选择器。Wan 2.7、Seedance 2.0、Seedream 5 Pro、
Nano Banana Pro、GPT Image 2、Kimi K3 和 Seed Audio 仅在官方目录仍存在时置顶。

最近模型按文生图、图像编辑、文生视频、图生视频、参考生视频、LLM、语音和音乐分别记忆。
已选模型从目录消失时会阻止提交并提示重新选择，不会静默换成另一个收费模型。

## Schema 与音频执行

- `/api/proxy/atlas/schema` 只读取官方静态 Schema，并向前端返回清洗后的字段、必填项、
  默认值、枚举、上下限、数组项和 `oneOf` 模式摘要。
- Atlas 音频统一通过 `/model/generateAudio`。语音和音乐结果经流式下载、媒体校验及原子落盘；
  ASR 结果写入文本端口。
- 所有收费请求沿用 Run/Attempt 的稳定提交身份。Atlas 接受任务后只轮询原任务；网络状态不明时
  前端不会自动重复提交。
