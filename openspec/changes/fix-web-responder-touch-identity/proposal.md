# Proposal

## Why

HAM-44 合并后的 `8a702a9` 仍能通过 Chromium CDP 的 trusted 多指输入复现左下角 “Cannot find single active touch.”。RN Web 的触点标识归一化会产生冲突或无法扫描的负索引；需要修复触摸历史，而不是屏蔽提示。

## What Changes

- 保证 Web responder 中同时存活的触点身份唯一且稳定，支持负值、大值及取模同余的原始 touch identifier。
- 对锁定的 RN Web 0.21.2 提供可重装的依赖补丁，保留 Expo 开发期错误展示及其他真实警告；上游升级仅在相同用例验证通过后替代补丁。
- 补充真实浏览器多指回归与 iPad 复验路径，保持 HAM-44 的三档输入、负 pointerId、双指导航、笔触冻结和 down-time 归属。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `input-session-viewport`: 增加 Web responder 触点身份正确性与无伪错误提示的约束，覆盖双指退回单指、取消及连续多轮输入。

## Impact

- 依赖落点：`react-native-web/src/modules/useResponderEvents/createResponderEvent.js` 的 `normalizeIdentifier` 及对应分发产物；通过 pnpm 补丁与锁文件交付，不直接提交 node_modules。
- 回归落点：`tests/ui/mobile-input-mode-real-input.spec.ts`、现有 HAM-44 输入测试；补丁级测试覆盖 responder history 与 TouchHistoryMath 消费契约。
- 不改变文档格式、控制器公共 API 或 RN 原生输入实现。无应用业务逻辑改动的预期；提案不执行补丁或测试代码实现。
- 证据与限制见 `evidence/README.md`：浏览器复现已完成，iPad 原始现场触点编号尚待真机确认。
