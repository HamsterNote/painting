# HAM-258 WebKit 与间距补验

本轮基于 PR #56 的 `ae13c18`，只修改测试／配置／验收资料及应用产品经理的两文档规格补丁，没有修改布局或绘图代码。

## 环境

Linux headless，Node v24.15.0、pnpm 10.28.2、Playwright 1.59.1，webkit-2272 / WPE WebKit 2.53.0；UA 为 Version/26.4 Safari/605.1.15。这是 Linux 的 WPE WebKit，不能当作 Safari/iOS 真机。浏览器 sys/lib 已由协作方补齐兼容库，启动使用 `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`；实际通过版本查询及 launch 验证，当前不再有缺库阻塞。

## 指定命令与分类

```bash
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PLAYWRIGHT_PORT=53258 pnpm exec playwright test --config=playwright.webkit.config.ts tests/ui/painting-toolbar.spec.ts --project=webkit
```

最终退出码 **0**，**21 passed / 3 skipped**。三个 skipped 是 Chromium CDP pen 输入及两档 CDP 页面缩放仿真，原 Chromium 套件完整执行这些断言，未删除其覆盖。第二引擎的三档 S2/S3/S5/S6 stroke smoke 均通过。

最初按原配置执行返回 `Error: No tests found.` / exit 1：CLI 文件过滤不会覆盖 `testMatch`。已将 painting-toolbar.spec.ts 加入 WebKit 配置。随后首轮新增样式断言出现 3 个失败 / exit 1：WebKit 在带变量的渐变规则里保留十六进制颜色，测试只接受 rgb 字符串。属于断言失败，不是环境失败，也没有发现产品渲染差异；改为接受同一精确颜色的等价序列化后全部通过。原始错误见 `logs/webkit-style-serialization-failure.txt`。首轮历史 host 校验失败见 `logs/webkit.txt`，不代表当前状态。

## S5 第二引擎视觉与样式

步骤：在 1280×900、390×900、320×900 打开笔触菜单，验证宽度极值及非法草稿；用键盘打开缩放并调到 125%；检查焦点，鼠标移动到滑块后按下／抬起，回到笔触菜单再收起展开。

期望：44px 交互区、appearance:none、2px 紫色焦点环／2px 偏移；6px 灰轨、紫进度；18px 白色滑块与2px紫边，hover／pressed有不同光晕；菜单无宿主横向溢出，收起有效。

实际：三档均通过。`evidence/webkit-stroke-{1280,390,320}.png` 与 `webkit-zoom-{1280,390,320}.png` 为固定视口完整截图，`webkit-*-preview-{0.5,200}.png` 为极值；已人工查看 390px 笔触、320px 缩放，控件无裁切，外观与规范一致。

`webkit-styles-{width}.json` 保存真实 input 的计算样式（44px、appearance:none、2px紫环／2px偏移、有效填充12.9032258%）及匹配 CSSOM 规则。WebKit 对滑条内部伪元素的 getComputedStyle 返回空值，因此不伪造伪元素计算值；轨道6px、滑块18px、边框2px、4px／6px光晕来自匹配规则，并以真实截图像素交叉验证。

`check_range_pixels.py`（Pillow 12.1.1）检查两个引擎、三档视口的六张 range 实际裁剪图。退出码 **0**：每张命中高度44、灰轨6、紫填充6、滑块外径18、白色内径14，穿过中心的上下紫边合计4px。圆边抗锯齿用 RGB 每通道20以内识别紫色、15以内识别白色；轨道与填充要求精确 RGB。输出在 `evidence/range-pixel-assertions.json`。

## 产品经理规格补丁对账

补丁附件 ID `01a1d596-f38f-7347-8227-99729c573e22`，原样修改 change 的 spec 与 design；明确8px是现有底部基础间距，top仍16px。布局代码未变。

步骤：分别在1280／1440 CSS px 宽、900px高的真实 painting 工具栏夹具，量外壳相对所属画板边界的距离；默认模式通过宿主 CSS 安全区变量设置0／34；受控模式设置bottom=34／0，并在受控0时保持fallback=34，验证不回退；再切top=24/header=44。

| 测量项                      | 期望 | 1280 实际 | 1440 实际 | 判定 |
| --------------------------- | ---- | --------- | --------- | ---- |
| 默认有效安全区0             | 8px  | 8px       | 8px       | 通过 |
| 默认有效安全区34            | 42px | 42px      | 42px      | 通过 |
| 受控bottom=34               | 42px | 42px      | 42px      | 通过 |
| 受控bottom=0（fallback=34） | 8px  | 8px       | 8px       | 通过 |
| top=24/header=44            | 60px | 60px      | 60px      | 通过 |

`pnpm test:toolbar` 退出码 **0**，**16 passed**（含新增两档对账）；逐条原始测量输出见 `logs/toolbar-followup.txt` 及 `evidence/PM-spacing-measurements.json`。

## 回归与剩余边界

新增样式断言后的指定 Chromium 三文件命令退出码 **0**，**40 passed**；原始输出见 `logs/chromium-followup.txt`。本轮没有修改产品代码，上一轮的单测／类型检查／库构建结论保持对应同一实现。所有改动文件格式检查通过。

任务3.1补验完成，任务总计14/14；实际有压力笔设备、Expo DOM/WebView宿主、系统IME/HID仍为未验证。本次浏览器验收不替代这些设备结论。

补充聚焦复跑：`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PLAYWRIGHT_PORT=53258 pnpm exec playwright test --config=playwright.stroke-webkit.config.ts` exit **0**，3 passed；完整三档 hover／pressed 裁剪图已保存为 `webkit-range-{hover,pressed}-{width}.png`。
