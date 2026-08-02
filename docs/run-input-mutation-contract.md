# Run 输入变更与运行态回写契约

状态：P0-D 设计基线。本文只定义兼容现有 CAS、durable Run、RunIntent、Attempt identity 与恢复账本的前端执行边界。

## 1. Mutation provenance

画布变更分为两类：

- `input`：默认类别。节点/边增删、prompt、模型、Provider 参数、素材、上游输出的人工替换以及所有没有显式来源的变更都属于 input，递增 `inputMutationEpoch`。
- `runtime`：只允许当前 Run 的状态、进度、错误、日志和输出回写。必须同时携带 `runId`、`nodeId`、`attemptId` 与 `executionToken`，且四者仍匹配当前活跃 Attempt；否则拒绝或按 input 失败关闭。runtime 递增 `runtimeMutationEpoch`，不递增 input epoch。

旧 `graphMutationEpoch` 暂时保留给 CanvasPatch/本地并发合并，避免把运行输入整改扩大成 Patch/CAS 迁移。新增 API 默认 input；只有显式 runtime hook 能写 runtime。

## 2. RunInputFingerprint

fingerprint 的权威范围是目标节点与沿入边递归得到的实际依赖切片，而不是整张画布。稳定序列化包含：

- 节点 id、持久 type 与输入 data；
- 切片内边的 source/target/handle；
- 上游输出值，因为它们是下游下一次运行的真实输入。

纯 UI/运行态字段（选中、位置、尺寸、status、progress、error、日志、轮询身份与时间戳）不进入 fingerprint。当前 Attempt 拥有的输出回写由 provenance 账本豁免；同一输出字段经默认 input API 人工修改时，所有权被清除并必须改变 fingerprint。

## 3. 执行检查

1. Preflight 捕获 project/canvas/revision、input/runtime epoch、目标依赖切片和 fingerprint。
2. 若 project/canvas 改变，立即终止。
3. 若 revision 与 input epoch 均未改变，快速通过；runtime epoch 可变化。
4. 若 revision 或 input epoch 改变，重新计算同一目标切片 fingerprint：相同表示运行态或无关节点变化，可继续；不同以 `RUN_INPUT_CHANGED` 终止。
5. Provider 提交前、Run 创建后、Attempt 准备后重复执行同一检查。真实多标签页写冲突继续由服务端 CAS/revision 阻止。

## 4. 身份隔离与清理

runtime patch 只能更新其绑定 node；延迟的旧 token/attempt 更新必须丢弃。失败、停止和 finally 清理只释放同一 run/node/attempt/token 拥有的 runtime 字段所有权、pending 状态和 active plan，不允许清除另一个节点或后来 Attempt 的状态。

## 5. 验收矩阵

- 不终止：status/progress/error/log 变化；无关节点变化；位置/选中变化；当前 Attempt 合法输出回写。
- 必须终止：目标或上游的 prompt/model/参数/素材变化，切片内边变化，节点增删，上游输出被 input provenance 改写。
- 身份：节点 A 的失败清理不影响 B；旧 Attempt 延迟回写不能覆盖新 Attempt；连续执行使用不同 token 均成功。

