# Proposal

## Why

HAM-55 用户报告在 iPad 上使用实体笔快速绘制时会误触发文字选择，打断书写。以该用户报告作为需求依据，补足画布业务输入与浏览器原生选词行为之间的边界；补丁基线上的真机表现和具体触发机制仍待验收。

## What Changes

- 绘制区域（包括非编辑态的文档文字）不因快速连续落笔、抬笔或相关浏览器默认行为误选文字、弹出选词菜单或中断笔迹。
- 将防护限制在画布非编辑区域；文字编辑器、输入框及其他安全控件保留选择、复制粘贴、焦点与 IME，页面其他区域保持原有行为。
- 保留多边形双击闭合、文字对象业务选择、鼠标操作、三档输入模式、笔指混合导航及撤销重做，不用全局禁用双击或吞掉笔事件解决问题。
- 真机验收必过：对照 HAM-50 补丁基线与候选版本；若基线真机验收不复现，则直接关闭本 change，不交付多余改动。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `document-object-interaction`: 明确画布非编辑区域的原生文字选择防护与编辑控件例外，并约束既有绘制、编辑和多边形完成行为不回退。

## Impact

基线为 HAM-50 分支提交 `9834cec`（PR #26 尚未合并，来源为本轮派发信息）。预计涉及 `packages/painting/src/layered/DrawingSurface.tsx`、`DisplayLayer.tsx`、`TextEditor.tsx` 的局部样式，以及必要时 `semanticWebAdapter.ts` 的默认行为边界和配套测试。无公共 API、文档格式或依赖变更。

静态代码事实已核查；本轮无合成输入或 CDP 实测，iPad Safari + 实体笔结论为「待验收」。尚无证据证明 RNW responder 是根因，方案不修改 `patches/`、`package.json`、`pnpm-lock.yaml`，不新增必须等待 HAM-50 合并的应用顺序约束；诊断和验收始终使用包含该补丁的基线。
