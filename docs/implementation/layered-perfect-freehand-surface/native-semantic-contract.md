# Future native semantic adapter contract

本期 Web/iOS/Android 使用 Web 编辑器。`input/native/layeredSemanticContract.ts` 仅定义未来可替换边界，不实现 native ink、真实桥或预测算法。

- Web 在 begin 发放 session/commit identity，并锁定 brush、resolved mode、viewport revision。native 预览不得创建独立 viewport 或对 WebView 做 transform 补偿。
- end 一次提交 `acceptedSamples`（真实 world raw，含 phase/source/sequence/pressure/time）、落笔快照与 commitId；Web 校验 lease/revision/样本，使用共享 PF 生成 final 和幂等事务。预测点不属于消息字段，不进入 acceptedSamples；不能把 native 预览轮廓当成最终数据。
- viewport-intent 由 Web 的 `updateViewport` 决定是否应用；collecting 自由笔期间拒绝竞争变换，不在 end 后补应用。
- 非笔工具发送 begin/update/end/cancel 和完整轨迹 batch，尤其 eraser/lasso 不能只发终点。使用同一 `createLayeredToolSession` 几何路径，不 dispatch 假 DOM hover。
- 进入文字时显式交回 Web DOM 焦点和键盘所有权，退出时恢复输入捕获。native overlay 不天然穿透；需要设备上的 focus/keyboard 验证。
- `commit-result` 只表示文档结果。Web 的挂载/geometry ACK 只证明内部呈现就绪。native 何时清除近似墨迹必须另行验证桥延迟和真实 physical paint，不可按 props 到达、固定帧数或 mock ACK 声称同帧原子交接。

Mock 合约测试在 `__tests__/core/layered-native-contract.test.ts`，只验证 Web 权威和语义轨迹，不是 bridge/device/performance 证据。
