# Tasks

## 1. 默认黑色与首层笔触入口

- [x] 1.1 在新建画板实际入口验证默认参数与首笔快照；仅在发现无显式设置入口覆盖黑色时修正该链路。按S1断言自由笔／形状均为#2D2D2D，显式绿色与已有对象不变，并记录是否复现及构建版本。
- [x] 1.2 在 `Toolbar.tsx` 用笔触按钮替换首层64×44输入，增加互斥stroke面板；移除尾部调色板及多余分隔线。按S2核对组序、无空位、同一时间只一弹层及文件菜单互斥。
- [x] 1.3 用工具快照派生S型SVG的颜色、宽度和不透明度，按design的1–6px单调映射防裁切，补可访问名称、状态和真实参数说明。按S3验证0.5／3.5／12／200、外部更新及自定义色，截图确认不是固定图标。

## 2. 笔触菜单与状态同步

- [x] 2.1 在stroke面板增加笔宽滑条和右侧64×44数字输入，复用权威更新／回读链路和 `ToolbarNumberField` 草稿语义。按S3及S4验证有效／空／越界／小数输入、拒绝回读、外部更新与工具族草稿隔离。
- [x] 2.2 将六色、自由取色及自定义编辑整体迁入stroke颜色区，保留色环／勾号互斥和inlinePickers分支，修正面板button全宽样式影响。按S2／S4验证完整六色顺序、非预设色表示、DOM归属和原生picker不在inline模式挂载。
- [x] 2.3 迁移不透明度、压力四模式与形状线型，一般设置仅留输入模式和导航开关；不支持工具禁用入口，外部切到不支持工具时关闭面板。按S4／S7断言两族独立、一般设置仍可用、后续笔画设置生效且旧对象／历史不变。

## 3. 缩放滑条与交互边界

- [x] 3.1 在 `toolbarStyles.ts` 为range增加跨引擎track/thumb样式与有效值填充，覆盖缩放及笔宽滑条。按S5检查6px灰轨／紫填充、18px白色紫边滑块、44px交互区及焦点／hover／pressed状态；Chromium与WebKit或Expo DOM分别截图记录。
- [x] 3.2 保留缩放25–800%、步长25、72px入口、视区中心锚定和拒绝路径，验证S5及S8；数值变化时入口／胶囊／scrollWidth严格相等，世界中心点屏幕误差不超过1 CSS px，书写冻结拒绝不补执行。
- [x] 3.3 复用 `ToolbarPopover` 焦点、所属栏边界与滚动，验证S6／S8的Tab、Enter／Space、Escape焦点恢复、收起关闭、跨界首击和两栏top／bottom；在320／390px及200%缩放下记录无宿主横向溢出、所有菜单项可达。

## 4. 回归验证与交接证据

- [x] 4.1 更新 `packages/painting/src/__tests__/layered-toolbar.test.tsx`、`toolbar-inline-pickers.test.tsx` 及受影响工具栏单测；使用 `pnpm exec jest --runInBand packages/painting/src/__tests__/layered-toolbar.test.tsx packages/painting/src/__tests__/toolbar-inline-pickers.test.tsx` 验证，通过语义断言覆盖新入口、独立参数、拒绝与输入草稿，保留原有行为验证。
- [x] 4.2 更新 `tests/ui/painting-toolbar.spec.ts`、`toolbar-round4.spec.ts`、`native-toolbar-bridge.spec.ts` 中旧入口假设，补S1–S8适用的浏览器覆盖；运行 `pnpm exec playwright test --config=playwright.config.ts tests/ui/painting-toolbar.spec.ts tests/ui/toolbar-round4.spec.ts tests/ui/native-toolbar-bridge.spec.ts --project=chromium`，记录用例结果与失败证据。
- [x] 4.3 执行 `pnpm typecheck`、`pnpm build:lib` 和 `pnpm test:toolbar` 检查类型、公开产物及共享栏／布局契约；记录命令退出码。失败时修正本次引入问题，环境阻碍或已存失败单独说明，不冒充通过。
- [x] 4.4 逐项执行 `proposal.md` 冒烟／自测S1–S8，交付记录包含步骤、期望、实际、判定、截图／快照及环境版本；真实压力效果用有压力笔设备，Expo DOM用实际宿主，缺失环境明确标为未验证。撤销／重做、保存重载对比对象快照，确认设置本身不新增历史。
- [x] 4.5 汇总实现差异、自动化结果、视觉截图及未验证设备项，运行 `openspec validate refine-painting-stroke-controls --strict`；核对每条变更规格都有测试或手工证据后交付评审。

## 验证记录

3.1 已补齐 Chromium／WebKit 1280／390／320 截图、计算样式与 CSSOM 规则、六张真实滑条裁剪图的像素断言。WebKit 指定整文件命令 exit 0（21 passed／3 个 Chromium CDP 专用用例 skipped，后者仍在 Chromium 40/40 中覆盖）；产品经理两文档规格补丁已应用，1280／1440 间距测量全部通过。当前任务14/14。

真实压力设备与实际 Expo DOM 宿主仍未验证，不用浏览器替身冒充通过。最新证据见 `docs/implementation/refine-painting-stroke-controls/webkit-followup.md`，首轮日志作为历史保留。
