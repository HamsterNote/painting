/**
 * fixture 的稳定内容定义：8 种 V2 对象文档 + world/screen overlay。
 * 纯 TS 模块，不导入 Skia / RN，可被任何平台安全引用。
 * 所有坐标均为世界 DIP（f64），与视口无关。
 */
import type { DrawingValueV2 } from '../../../../packages/painting/src/core/index';
import type { SkiaOverlay } from '@hamster-note/painting/skia';
import { FIXTURE_IMAGE_SRC } from './fixtureAssets';

/** 对象图例：序号即文档顺序（后绘制者在上层），供外层可访问文本渲染 */
export const FIXTURE_OBJECT_LEGEND = [
  { tool: 'pen', label: 'pen — 自由笔迹（墨蓝，尾部与 line 相交，被 line 压盖）' },
  { tool: 'line', label: 'line — 直线（深灰，位于 pen 之上）' },
  { tool: 'rect', label: 'rect — 旋转矩形（绿描边浅绿填充）' },
  { tool: 'ellipse', label: 'ellipse — 椭圆（紫描边浅紫填充）' },
  { tool: 'polygon', label: 'polygon — 五边形（橙描边浅橙填充）' },
  { tool: 'bezier', label: 'bezier — 三次曲线 S 弯（红色）' },
  { tool: 'text', label: 'text — 文本 "Skia Text 123"（FixtureSans 真实 glyph）' },
  { tool: 'image', label: 'image — 96×64 程序生成 PNG（压盖 text 框右缘，顺序可见）' },
] as const;

/**
 * 稳定的 8 对象 V2 文档。排布从左到右、从上到下，并刻意制造少量压盖，
 * 使文档顺序（数组顺序 = 绘制顺序）在画面上可直接读出。
 */
export const FIXTURE_DOCUMENT: DrawingValueV2 = {
  schemaVersion: 2,
  strokes: [
    // 1) pen：自由波形笔迹，尾部下探与 line 起点相交
    {
      schemaVersion: 2,
      id: 'fixture-pen',
      tool: 'pen',
      points: [
        { x: 48, y: 64 },
        { x: 76, y: 44 },
        { x: 104, y: 70 },
        { x: 132, y: 46 },
        { x: 160, y: 74 },
        { x: 188, y: 52 },
        { x: 206, y: 92 },
        { x: 196, y: 128 },
      ],
      strokeColor: '#3B5BDB',
      strokeWidth: 3,
    },
    // 2) line：压过 pen 尾部的直线
    {
      schemaVersion: 2,
      id: 'fixture-line',
      tool: 'line',
      points: [
        { x: 48, y: 140 },
        { x: 220, y: 108 },
      ],
      strokeColor: '#24252A',
      strokeWidth: 2.5,
    },
    // 3) rect：轻旋转矩形，闭合填充
    {
      schemaVersion: 2,
      id: 'fixture-rect',
      tool: 'rect',
      points: [
        { x: 264, y: 36 },
        { x: 396, y: 108 },
      ],
      rotationRad: 0.16,
      strokeColor: '#2E7D32',
      strokeWidth: 2.5,
      fillColor: '#E3F1E4',
      fillOpacity: 0.9,
    },
    // 4) ellipse：椭圆，闭合填充
    {
      schemaVersion: 2,
      id: 'fixture-ellipse',
      tool: 'ellipse',
      points: [
        { x: 428, y: 40 },
        { x: 556, y: 116 },
      ],
      strokeColor: '#7B1FA2',
      strokeWidth: 2.5,
      fillColor: '#F1E6FA',
      fillOpacity: 0.9,
    },
    // 5) polygon：五边形
    {
      schemaVersion: 2,
      id: 'fixture-polygon',
      tool: 'polygon',
      points: [
        { x: 300, y: 148 },
        { x: 352, y: 172 },
        { x: 340, y: 228 },
        { x: 288, y: 240 },
        { x: 260, y: 196 },
      ],
      strokeColor: '#E65100',
      strokeWidth: 2.5,
      fillColor: '#FCEBD8',
      fillOpacity: 0.9,
    },
    // 6) bezier：恰好 4 个控制点的 S 弯三次曲线
    {
      schemaVersion: 2,
      id: 'fixture-bezier',
      tool: 'bezier',
      points: [
        { x: 400, y: 160 },
        { x: 460, y: 128 },
        { x: 520, y: 268 },
        { x: 580, y: 216 },
      ],
      strokeColor: '#C62828',
      strokeWidth: 3,
    },
    // 7) text：文本框（右缘伸到 image 之下，被 image 压盖以显示顺序）
    {
      schemaVersion: 2,
      id: 'fixture-text',
      tool: 'text',
      points: [
        { x: 48, y: 260 },
        { x: 340, y: 320 },
      ],
      text: 'Skia Text 123',
      fontSize: 22,
      strokeColor: '#1A237E',
      strokeWidth: 1,
    },
    // 8) image：程序生成 PNG，压在 text 框右缘之上（文档末尾 = 最上层）
    {
      schemaVersion: 2,
      id: 'fixture-image',
      tool: 'image',
      points: [
        { x: 300, y: 268 },
        { x: 492, y: 396 },
      ],
      src: FIXTURE_IMAGE_SRC,
      strokeColor: '#455A64',
      strokeWidth: 1.5,
    },
    // ===== 阶段 6 空间/帧验证条目（追加，不改动以上 8 工具主文档的任何点） =====
    // 9) 跨 cell 巨大矩形：bounds 覆盖 ±2600/±2300 世界 DIP，跨大量索引 cell。
    //    凸闭合形状部分裁剪时走 semantic-area 填充 + 仅真实边 stroke 片段，
    //    不补人工裁剪边。partial 椭圆另在几何 program 专用场景中覆盖。
    {
      schemaVersion: 2,
      id: 'fixture-giant-cross-cell',
      tool: 'rect',
      points: [
        { x: -2600, y: -1900 },
        { x: 3400, y: 2300 },
      ],
      strokeColor: '#91A7FF',
      strokeWidth: 4,
      dashArray: [24, 16],
    },
    // 10/11) 重叠 z-order 对：b 在 a 之上（文档顺序即绘制顺序），供 hit probe 观察 topmost
    {
      schemaVersion: 2,
      id: 'fixture-overlap-a',
      tool: 'rect',
      points: [
        { x: 560, y: 220 },
        { x: 680, y: 320 },
      ],
      strokeColor: '#C0392B',
      strokeWidth: 2,
      fillColor: '#F8D7DA',
      fillOpacity: 0.9,
    },
    {
      schemaVersion: 2,
      id: 'fixture-overlap-b',
      tool: 'rect',
      points: [
        { x: 600, y: 250 },
        { x: 720, y: 350 },
      ],
      strokeColor: '#2F54EB',
      strokeWidth: 2,
      fillColor: '#D6E4FB',
      fillOpacity: 0.9,
    },
    // 12) 负世界坐标矩形：默认视口外，pan/跳转到负坐标区域后可见
    {
      schemaVersion: 2,
      id: 'fixture-negative-rect',
      tool: 'rect',
      points: [
        { x: -900, y: -700 },
        { x: -600, y: -500 },
      ],
      strokeColor: '#2E7D32',
      strokeWidth: 2.5,
      fillColor: '#E3F1E4',
      fillOpacity: 0.9,
    },
    // 13) 远正坐标笔迹（约 50k/40k DIP）：验证 frame origin 重基后局部坐标仍很小
    {
      schemaVersion: 2,
      id: 'fixture-far-positive',
      tool: 'pen',
      points: [
        { x: 50000, y: 40000 },
        { x: 50120, y: 39960 },
        { x: 50240, y: 40040 },
        { x: 50360, y: 39980 },
        { x: 50400, y: 40160 },
      ],
      strokeColor: '#3B5BDB',
      strokeWidth: 3,
    },
    // 14) 超远笔迹（约 2M/1.5M DIP）：标准 maxLocalCoordinate(1e6) 下跳转至此仍
    //     不触发 requiresClipping（重基点随行），仅裁剪演示阈值下才触发。
    {
      schemaVersion: 2,
      id: 'fixture-ultra-far',
      tool: 'pen',
      points: [
        { x: 2000000, y: 1500000 },
        { x: 2000120, y: 1499960 },
        { x: 2000240, y: 1500040 },
        { x: 2000400, y: 1500160 },
      ],
      strokeColor: '#7048E8',
      strokeWidth: 3,
    },
    // 15) 超长开放虚线锯齿：反复穿越默认视口下缘（y=421），被裁为多个互不桥接的
    //     stroke fragments（status=segmented），正常安全可绘、可命中。
    {
      schemaVersion: 2,
      id: 'fixture-segmented-dash-pen',
      tool: 'pen',
      points: Array.from({ length: 26 }, (_, index) => ({
        x: -160 + index * 40,
        y: index % 2 === 0 ? 384 : 452,
      })),
      strokeColor: '#0B7285',
      strokeWidth: 3,
      dashArray: [10, 6],
    },
    // 16) 凸闭合部分裁剪演示：填充矩形底边越出默认视口（y>421），可见部分应为
    //     semantic-area 填充 + 仅真实边 stroke，不出现人工裁剪边。
    {
      schemaVersion: 2,
      id: 'fixture-convex-partial-fill',
      tool: 'rect',
      points: [
        { x: 40, y: 330 },
        { x: 260, y: 520 },
      ],
      strokeColor: '#1971C2',
      strokeWidth: 3,
      fillColor: '#E7F5FF',
      fillOpacity: 0.55,
    },
    // 17/18) 约 ±(1e9 + 0.125) 世界坐标的安全对象：frame origin 重基后局部坐标
    //     极小，标准预算下可绘可命中；f64 可精确表示 .125，不触碰 2^53 成功语义。
    {
      schemaVersion: 2,
      id: 'fixture-giga-positive',
      tool: 'pen',
      points: [
        { x: 1e9 + 0.125 - 80, y: 1e9 + 0.125 - 40 },
        { x: 1e9 + 0.125, y: 1e9 + 0.125 + 30 },
        { x: 1e9 + 0.125 + 90, y: 1e9 + 0.125 - 20 },
      ],
      strokeColor: '#C2255C',
      strokeWidth: 3,
    },
    {
      schemaVersion: 2,
      id: 'fixture-giga-negative',
      tool: 'pen',
      points: [
        { x: -(1e9 + 0.125) + 80, y: -(1e9 + 0.125) + 40 },
        { x: -(1e9 + 0.125), y: -(1e9 + 0.125) - 30 },
        { x: -(1e9 + 0.125) - 90, y: -(1e9 + 0.125) + 20 },
      ],
      strokeColor: '#5F3DC4',
      strokeWidth: 3,
    },
    // ===== 局部资源裁剪场景（世界 5000,5000 区域，配「资源裁剪」跳转） =====
    // 画布高度固定 420 DIP，因此跳转居中后上下视口边缘恒为 y=5000∓210（与宽度无关），
    // 以下框体按此确定性地跨越边缘。
    // 19) 旋转文本框跨越上边缘：大字号让 glyph 带（框顶部起约 48 DIP）正好被视口
    //     上缘斜切（rotation 0.12 使左侧切得更多），肉眼可见被裁掉的字形顶部。
    //     partial text → resourceBox fragment + local clip，renderer 以外层 Group clip
    //     + 完整旋转 Paragraph 绘制（可见区可命中）。
    {
      schemaVersion: 2,
      id: 'fixture-clip-text',
      tool: 'text',
      points: [
        { x: 4830, y: 4780 },
        { x: 5170, y: 4880 },
      ],
      rotationRad: 0.12,
      text: 'Clip 456',
      fontSize: 40,
      strokeColor: '#1A237E',
      strokeWidth: 1,
    },
    // 20) 旋转图片框跨越下边缘（约 80 DIP 可见区）：partial image → 同上，安全局部资源裁剪。
    {
      schemaVersion: 2,
      id: 'fixture-clip-image',
      tool: 'image',
      points: [
        { x: 4920, y: 5130 },
        { x: 5080, y: 5250 },
      ],
      rotationRad: -0.25,
      src: FIXTURE_IMAGE_SRC,
      strokeColor: '#455A64',
      strokeWidth: 1.5,
    },
    // 21) 高椭圆明显跨越上下边缘（上下各越界 40 DIP，考虑 1 DIP guard 后仍 partial）：
    //     partial ellipse 通过认证 contour 产出安全 program；实际失败仍由 frame diagnostics
    //     如实报告为 unresolved，绝不在 fixture 中伪造成功状态。
    {
      schemaVersion: 2,
      id: 'fixture-clip-ellipse',
      tool: 'ellipse',
      points: [
        { x: 4660, y: 4750 },
        { x: 4740, y: 5250 },
      ],
      strokeColor: '#7B1FA2',
      strokeWidth: 3,
    },
    // 22) 同场景安全笔迹（对照组）：完整在视口内，正常渲染/命中。
    {
      schemaVersion: 2,
      id: 'fixture-clip-pen',
      tool: 'pen',
      points: [
        { x: 4900, y: 4970 },
        { x: 4980, y: 5030 },
        { x: 5060, y: 4980 },
        { x: 5120, y: 5020 },
      ],
      strokeColor: '#2E7D32',
      strokeWidth: 3,
    },
    // ===== 几何 program 专用场景（世界约 5M,5M，配「几何 program」跳转） =====
    // 这些对象故意跨越跳转后视口的边缘。它们让 Web CanvasKit 直接消费与 hit 相同的
    // renderable program，而不是完整 source geometry 或人工拼接的裁剪边。
    // 23) 高曲率 cubic：端点和控制点均在中心视口外，中心分支稳定落在画布上方偏右。
    //     它与 ellipse / compound 分置，避免高层填充掩盖可复现的 curve hit/readback 证据。
    {
      schemaVersion: 2,
      id: 'fixture-geometry-partial-cubic',
      tool: 'bezier',
      points: [
        { x: 4999700, y: 4999910 },
        { x: 4999950, y: 4999600 },
        { x: 5000250, y: 5000140 },
        { x: 5000450, y: 4999910 },
      ],
      strokeColor: '#C2255C',
      strokeWidth: 3,
    },
    // 24) 旋转椭圆：左/下越出视口，稳定占据左中区域，不覆盖 cubic 或 self-intersect probe。
    {
      schemaVersion: 2,
      id: 'fixture-geometry-partial-ellipse',
      tool: 'ellipse',
      points: [
        { x: 4999730, y: 4999870 },
        { x: 5000030, y: 5000210 },
      ],
      rotationRad: 0.43,
      strokeColor: '#7B1FA2',
      strokeWidth: 2.5,
      fillColor: '#F1E6FA',
      fillOpacity: 0.7,
    },
    // 25) 凹闭合路径：底部跨界，保留单次 nonzero fill，位于下方中间区域。
    {
      schemaVersion: 2,
      id: 'fixture-geometry-partial-concave',
      tool: 'polygon',
      points: [
        { x: 4999900, y: 5000120 },
        { x: 5000080, y: 5000120 },
        { x: 5000080, y: 5000160 },
        { x: 5000160, y: 5000160 },
        { x: 5000160, y: 5000320 },
        { x: 4999960, y: 5000320 },
        { x: 4999960, y: 5000220 },
        { x: 4999900, y: 5000220 },
      ],
      strokeColor: '#E8590C',
      strokeWidth: 2.5,
      fillColor: '#FFF4E6',
      fillOpacity: 0.72,
    },
    // 26) 自交闭合路径：bow-tie 跨越右/下边界。上三角内部有稳定 probe，远离 ellipse
    //     与 concave；外部 probe 则验证 compound nonzero fill 不会越过真实边界。
    {
      schemaVersion: 2,
      id: 'fixture-geometry-self-intersect',
      tool: 'polygon',
      points: [
        { x: 5000020, y: 5000020 },
        { x: 5000330, y: 5000220 },
        { x: 5000020, y: 5000220 },
        { x: 5000330, y: 5000020 },
      ],
      strokeColor: '#1971C2',
      strokeWidth: 2.5,
      fillColor: '#E7F5FF',
      fillOpacity: 0.72,
    },
    // 27) contour/cap 压力 ellipse：约 900k DIP 半径超过旧 1024 段需求但低于 65,536
    //     安全 cap。右侧切线位于 geometry 视口左缘附近，故只留下窄的真实 partial 区域；
    //     不再让其 fill 覆盖整个画布或抢占所有 hit，同时仍保留大半径 program/预算性质。
    {
      schemaVersion: 2,
      id: 'fixture-geometry-contour-cap',
      tool: 'ellipse',
      points: [
        { x: 3199700, y: 4100000 },
        { x: 4999700, y: 5900000 },
      ],
      rotationRad: 0,
      strokeColor: '#7048E8',
      strokeWidth: 1.5,
      fillColor: '#F3F0FF',
      fillOpacity: 0.04,
    },
    // ===== Web CanvasKit shaping 专用场景（约 8M/-8M DIP） =====
    // 每个 partial 文本都保留完整 text + 原始 paragraphWidth，Web provider 绝不 substring
    // 或按可见 AABB 重新 layout。Latin 的 4,096 个 combining 字素必须被完整 shaping，
    // 再经 provider continuation 按真实 run cursor 完成；文本框跨视口左缘，稳定 clipped。
    // 四个对象按跳转后 420 DIP 画布内的独立水平带排布：避免超长 Latin 首行压住
    // CJK / Arabic / emoji，同时每种 fallback glyph 都能作为独立的视觉证据观察。
    {
      schemaVersion: 2,
      id: 'fixture-text-shaping-latin-combining',
      tool: 'text',
      points: [
        // 左缘在跳转视口外，完整首行进入画布，保留明确的 partial clipping。
        { x: 7999200, y: -8000202 },
        { x: 8000600, y: -8000122 },
      ],
      text: 'á'.repeat(4096),
      fontSize: 68,
      strokeColor: '#1A237E',
      strokeWidth: 1,
    },
    {
      schemaVersion: 2,
      id: 'fixture-text-shaping-cjk',
      tool: 'text',
      points: [
        { x: 7999720, y: -8000094 },
        { x: 8000040, y: -8000014 },
      ],
      text: '世界',
      fontSize: 72,
      strokeColor: '#C2255C',
      strokeWidth: 1,
    },
    {
      schemaVersion: 2,
      id: 'fixture-text-shaping-arabic',
      tool: 'text',
      points: [
        { x: 7999750, y: -7999986 },
        { x: 8000300, y: -7999906 },
      ],
      text: 'مرحبا',
      fontSize: 72,
      strokeColor: '#0B7285',
      strokeWidth: 1,
    },
    {
      schemaVersion: 2,
      id: 'fixture-text-shaping-emoji',
      tool: 'text',
      points: [
        { x: 8000040, y: -7999878 },
        { x: 8000280, y: -7999798 },
      ],
      text: '👨‍👩‍👧‍👦',
      fontSize: 72,
      strokeColor: '#E8590C',
      strokeWidth: 1,
    },
    // 32) 原始 Paragraph 宽度明确超过 core 默认预算。完整文本和原始 4m DIP 宽度保留在
    //     request 中，但 Web factory 只能接收 paragraphLayoutWidth=1m DIP；provider 必须用
    //     getLineMetrics 证明该有限 layout 未新增 soft wrap，才能让同一 ready program render/hit。
    {
      schemaVersion: 2,
      id: 'fixture-text-shaping-over-budget-width',
      tool: 'text',
      points: [
        { x: 7999800, y: -7999950 },
        { x: 11999800, y: -7999870 },
      ],
      text: 'CanvasKit original paragraph width budget probe',
      fontSize: 48,
      strokeColor: '#5F3DC4',
      strokeWidth: 1,
    },
  ],
};

/**
 * overlay 演示：一条 world 虚线 + 端点 marker（锚点随视口投影，线宽/marker 屏幕恒定），
 * 一个 screen 圆点 + 标注（固定屏幕坐标，视口变化不影响）。
 */
export const FIXTURE_OVERLAYS: readonly SkiaOverlay[] = [
  {
    id: 'overlay-world-line',
    kind: 'line',
    space: 'world',
    from: { x: 48, y: 336 },
    to: { x: 224, y: 392 },
    style: { color: '#E65100', strokeWidth: 2, dashArray: [8, 6] },
  },
  {
    id: 'overlay-world-marker',
    kind: 'circle',
    space: 'world',
    center: { x: 224, y: 392 },
    radius: 9,
    style: { color: '#E65100', strokeWidth: 2 },
  },
  {
    id: 'overlay-screen-marker',
    kind: 'circle',
    space: 'screen',
    center: { x: 22, y: 22 },
    radius: 8,
    style: { color: '#D6336C', strokeWidth: 2.5 },
  },
  {
    id: 'overlay-screen-label',
    kind: 'text',
    space: 'screen',
    origin: { x: 38, y: 27 },
    text: 'screen',
    fontSize: 13,
    style: { color: '#D6336C' },
  },
];

// ===== 角色 overlay：覆盖阶段 5.2 的屏幕恒定叠层语义 =====
// 只用既有 SkiaOverlay 原语（line/polyline/circle/rect/text），纯静态数据，无领域状态机。
// world 角色的锚点/顶点随视口投影、线宽与 marker 屏幕恒定；screen 角色固定屏幕坐标。

/** 选框（world）：套住五边形的虚线矩形，四角各一个手柄圆点 */
const SELECTION_BOX = { x: 252, y: 140, width: 108, height: 108 } as const;
const SELECTION_COLOR = '#2878FF';

const selectionOverlays: readonly SkiaOverlay[] = [
  {
    id: 'overlay-role-selection-box',
    kind: 'rect',
    space: 'world',
    origin: { x: SELECTION_BOX.x, y: SELECTION_BOX.y },
    width: SELECTION_BOX.width,
    height: SELECTION_BOX.height,
    style: { color: SELECTION_COLOR, strokeWidth: 1.5, dashArray: [6, 4] },
  },
  // 四个角手柄（world 圆：圆心随视口投影，半径屏幕恒定）
  ...(
    [
      ['nw', SELECTION_BOX.x, SELECTION_BOX.y],
      ['ne', SELECTION_BOX.x + SELECTION_BOX.width, SELECTION_BOX.y],
      ['sw', SELECTION_BOX.x, SELECTION_BOX.y + SELECTION_BOX.height],
      ['se', SELECTION_BOX.x + SELECTION_BOX.width, SELECTION_BOX.y + SELECTION_BOX.height],
    ] as const
  ).map(([corner, x, y]) => ({
    id: `overlay-role-selection-handle-${corner}`,
    kind: 'circle' as const,
    space: 'world' as const,
    center: { x, y },
    radius: 4.5,
    style: { color: SELECTION_COLOR, strokeWidth: 2 },
  })),
];

/** 套索预览（world）：围绕自由笔迹的闭合虚线 */
const lassoOverlay: SkiaOverlay = {
  id: 'overlay-role-lasso-preview',
  kind: 'polyline',
  space: 'world',
  closed: true,
  points: [
    { x: 36, y: 36 },
    { x: 150, y: 28 },
    { x: 226, y: 60 },
    { x: 232, y: 128 },
    { x: 180, y: 150 },
    { x: 60, y: 140 },
    { x: 30, y: 96 },
  ],
  style: { color: '#5F3DC4', strokeWidth: 1.5, dashArray: [5, 4] },
};

/** 光标与橡皮指示（screen）：两个同心对照的圆，橡皮为更大的虚线圆 */
const cursorOverlays: readonly SkiaOverlay[] = [
  {
    id: 'overlay-role-cursor',
    kind: 'circle',
    space: 'screen',
    center: { x: 320, y: 190 },
    radius: 6,
    style: { color: '#202124', strokeWidth: 1.5 },
  },
  {
    id: 'overlay-role-eraser',
    kind: 'circle',
    space: 'screen',
    center: { x: 384, y: 190 },
    radius: 14,
    style: { color: '#E03131', strokeWidth: 1.5, dashArray: [4, 3] },
  },
];

/** 缩放反馈（screen）：百分比文本 + 基准线 */
const zoomOverlays: readonly SkiaOverlay[] = [
  {
    id: 'overlay-role-zoom-text',
    kind: 'text',
    space: 'screen',
    origin: { x: 556, y: 26 },
    // '125%' 中 '%' 字形宽度约 0.89em，超出 renderer 段落宽度启发式（len×size×0.6）
    // 的平均预算而必然换行；改用等义的 'x1.25'（平均宽度 0.49em，任意字号不换行）
    text: 'x1.25',
    fontSize: 13,
    style: { color: '#3A3C41' },
  },
  {
    id: 'overlay-role-zoom-line',
    kind: 'line',
    space: 'screen',
    from: { x: 556, y: 36 },
    to: { x: 620, y: 36 },
    style: { color: '#3A3C41', strokeWidth: 2 },
  },
];

/** 角度反馈（screen）：角度文本 + 45° 方向线 */
const angleOverlays: readonly SkiaOverlay[] = [
  {
    id: 'overlay-role-angle-text',
    kind: 'text',
    space: 'screen',
    origin: { x: 634, y: 66 },
    // 内嵌字体子集仅含可见 ASCII（° 不在其中），如实使用 'deg'
    text: '45 deg',
    fontSize: 13,
    style: { color: '#3A3C41' },
  },
  {
    id: 'overlay-role-angle-line',
    kind: 'line',
    space: 'screen',
    from: { x: 592, y: 88 },
    to: { x: 620, y: 60 },
    style: { color: '#3A3C41', strokeWidth: 2 },
  },
];

/** 尺子（screen）：填充条带 + 程序生成的刻度线（次刻度 16 DIP、主刻度 80 DIP） */
const RULER = { x: 16, y: 368, width: 320, height: 36 } as const;
const rulerBody: SkiaOverlay = {
  id: 'overlay-role-ruler-body',
  kind: 'polyline',
  space: 'screen',
  closed: true,
  points: [
    { x: RULER.x, y: RULER.y },
    { x: RULER.x + RULER.width, y: RULER.y },
    { x: RULER.x + RULER.width, y: RULER.y + RULER.height },
    { x: RULER.x, y: RULER.y + RULER.height },
  ],
  style: { color: '#868E96', strokeWidth: 1, fillColor: '#F1F3F4', fillOpacity: 1 },
};
const rulerTicks: readonly SkiaOverlay[] = Array.from(
  { length: Math.floor(RULER.width / 16) + 1 },
  (_, index) => {
    const x = RULER.x + index * 16;
    const major = index % 5 === 0;
    return {
      id: `overlay-role-ruler-tick-${index}`,
      kind: 'line' as const,
      space: 'screen' as const,
      from: { x, y: RULER.y },
      to: { x, y: RULER.y + (major ? 14 : 7) },
      style: { color: '#495057', strokeWidth: major ? 1.5 : 1 },
    };
  }
);

/** 角色 overlay 全集（在 surface 中与 FIXTURE_OVERLAYS 拼接后传给画布） */
export const FIXTURE_ROLE_OVERLAYS: readonly SkiaOverlay[] = [
  ...selectionOverlays,
  lassoOverlay,
  ...cursorOverlays,
  ...zoomOverlays,
  ...angleOverlays,
  rulerBody,
  ...rulerTicks,
];

/** 阶段 6 追加条目的图例（document 下标即 prepared key/order） */
export const FIXTURE_SPATIAL_ENTRY_LEGEND = [
  { id: 'fixture-giant-cross-cell', label: '跨 cell 巨大矩形（凸，部分裁剪 = semantic fill + 仅真实边）' },
  { id: 'fixture-overlap-a', label: '重叠对 a（红，在下层）' },
  { id: 'fixture-overlap-b', label: '重叠对 b（蓝，在上层，hit probe 应命中它）' },
  { id: 'fixture-negative-rect', label: '负世界矩形（-900,-700 → -600,-500）' },
  { id: 'fixture-far-positive', label: '远正笔迹（约 50k/40k DIP，重基后局部坐标小）' },
  { id: 'fixture-ultra-far', label: '超远笔迹（约 2M/1.5M DIP，标准阈值不裁剪）' },
  { id: 'fixture-segmented-dash-pen', label: '超长开放虚线锯齿（越出视口下缘 → segmented 多片段，安全可绘）' },
  { id: 'fixture-convex-partial-fill', label: '凸填充矩形部分裁剪（semantic fill 不画人工裁剪边）' },
  { id: 'fixture-giga-positive', label: '1e9+0.125 安全对象（跳转后 origin≈1e9，局部坐标仍小）' },
  { id: 'fixture-giga-negative', label: '-(1e9+0.125) 负对称安全对象' },
  { id: 'fixture-clip-text', label: '旋转文本框（上缘被裁 → resourceBox+clip，已渲染且可命中）' },
  { id: 'fixture-clip-image', label: '旋转图片框（下缘被裁 → resourceBox+clip，已渲染且可命中）' },
  { id: 'fixture-clip-ellipse', label: 'partial 椭圆（认证 contour → 安全 program；若真实诊断 unresolved 则不渲染、不命中）' },
  { id: 'fixture-clip-pen', label: '同场景安全笔迹（对照组）' },
  {
    id: 'fixture-geometry-partial-cubic',
    geometryTestId: 'partial-cubic',
    label: 'partial 高曲率 cubic（安全 renderable program；认证曲线细分近似，不承诺无视觉误差）',
  },
  {
    id: 'fixture-geometry-partial-ellipse',
    geometryTestId: 'partial-ellipse',
    label: 'partial 旋转 ellipse（安全 fill/stroke program；认证 contour 近似，不承诺无视觉误差）',
  },
  {
    id: 'fixture-geometry-partial-concave',
    geometryTestId: 'partial-concave',
    label: 'partial 凹闭合 polygon（单个 nonzero compound fill；只描真实源边，未绘人工裁剪边）',
  },
  {
    id: 'fixture-geometry-self-intersect',
    geometryTestId: 'self-intersect',
    label: '自交闭合 polygon（单个 nonzero compound fill；只描真实源边，未绘人工裁剪边）',
  },
  {
    id: 'fixture-geometry-contour-cap',
    geometryTestId: 'contour-cap',
    label: 'contour/cap 压力 ellipse（超过旧 1024 段需求且受 65,536 cap 约束；不承诺无视觉误差）',
  },
  {
    id: 'fixture-text-shaping-latin-combining',
    textShapingTestId: 'latin-combining',
    label: 'Web CanvasKit 超大 partial Latin + combining mark（4,096 个完整字素真实 shaping，status=clipped）',
  },
  {
    id: 'fixture-text-shaping-cjk',
    textShapingTestId: 'cjk',
    label: 'Web CanvasKit CJK「世界」（注册 Noto fallback chain，真实 shaping）',
  },
  {
    id: 'fixture-text-shaping-arabic',
    textShapingTestId: 'arabic',
    label: 'Web CanvasKit Arabic「مرحبا」（真实 RTL shaping）',
  },
  {
    id: 'fixture-text-shaping-emoji',
    textShapingTestId: 'emoji',
    label: 'Web CanvasKit emoji ZWJ「👨‍👩‍👧‍👦」（仅在运行时 FreeType+shaping 成功时 ready）',
  },
  {
    id: 'fixture-text-shaping-over-budget-width',
    textShapingTestId: 'over-budget-width',
    label: 'Web CanvasKit 原始 paragraph 宽 4,000,000 DIP（实际 layout 输入受 1,000,000 DIP 预算约束；仅 metrics 证明无新增换行后 ready）',
  },
] as const;

/** 视口跳转目标（世界 DIP 中心点）：供「视口跳转」控件把目标居中到画布 */
export const FIXTURE_JUMP_TARGETS = [
  { key: 'main', label: '主场景', x: 300, y: 200 },
  { key: 'negative', label: '负坐标', x: -750, y: -600 },
  { key: 'far', label: '远端 50k', x: 50200, y: 40080 },
  { key: 'ultra', label: '超远 2M', x: 2000200, y: 1500080 },
  { key: 'giga-pos', label: '1e9+0.125', x: 1e9 + 0.125, y: 1e9 + 0.125 },
  { key: 'giga-neg', label: '-(1e9+0.125)', x: -(1e9 + 0.125), y: -(1e9 + 0.125) },
  { key: 'resource-clip', label: '资源裁剪', x: 5000, y: 5000 },
  { key: 'geometry-program', label: '几何 program', x: 5000000, y: 5000000 },
  { key: 'text-shaping', label: '文本 shaping', x: 8000000, y: -8000000 },
] as const;

/**
 * geometry-program 专用探针的世界坐标。surface 把它们投影到当前 frame 后，实际调用
 * hitTestDrawingFrame；这些声明只提供可访问的预期，不伪造任何 CanvasKit 像素或命中结果。
 */
export const FIXTURE_GEOMETRY_HIT_PROBES = [
  {
    id: 'partial-cubic',
    label: 'partial cubic',
    expected: '命中 fixture-geometry-partial-cubic',
    point: { x: 5000093.75, y: 4999880 },
  },
  {
    id: 'partial-ellipse',
    label: 'partial ellipse',
    expected: '命中 fixture-geometry-partial-ellipse',
    point: { x: 4999880, y: 5000040 },
  },
  {
    id: 'compound-inside',
    label: 'compound inside',
    expected: '命中 fixture-geometry-self-intersect',
    point: { x: 5000080, y: 5000060 },
  },
  {
    id: 'compound-outside',
    label: 'compound outside',
    expected: '未命中 fixture-geometry-self-intersect 外部',
    point: { x: 5000260, y: 4999980 },
  },
] as const;

/** Web shaping 场景的世界坐标 probe。surface 仍只调用同一 frame 的真实 hitTestDrawingFrame。 */
export const FIXTURE_TEXT_SHAPING_HIT_PROBES = [
  {
    id: 'visible',
    label: 'visible clipped text',
    expected: '命中 fixture-text-shaping-latin-combining，status=clipped',
    // Latin 首行的画布内稳定字形位置；仍处于左缘越界的同一 partial text 对象。
    point: { x: 8000008, y: -8000170 },
  },
  {
    id: 'outside',
    label: 'outside text',
    expected: '未命中文本 semantic region 外部',
    // Latin 与 CJK 带之间的行间空白，避开全部文字对象及其 hit 容差。
    point: { x: 8000000, y: -8000108 },
  },
] as const;

/** 裁剪演示的显式演示阈值（DIP）：远小于 core 默认 1e6，仅用于触发 requiresClipping 诊断 */
export const CLIP_DEMO_MAX_LOCAL_DIP = 2000;

/**
 * frame 路径的 world overlay 坐标换算：fixture overlay 以 global world DIP 定义，
 * 而 frame 渲染要求 world overlay 与 visibleEntries.geometry 同为 frame 局部坐标。
 * 每个 world 锚点/顶点减去 frameOrigin；screen overlay 原样保留（identity screen DIP）。
 * 绝不把 global world overlay 直接交给 frame 路径。
 */
export function rebaseOverlaysToFrameOrigin(
  overlays: readonly SkiaOverlay[],
  frameOrigin: Readonly<{ x: number; y: number }>
): SkiaOverlay[] {
  const local = (point: Readonly<{ x: number; y: number }>) => ({
    x: point.x - frameOrigin.x,
    y: point.y - frameOrigin.y,
  });
  return overlays.map((overlay) => {
    if (overlay.space === 'screen') {
      return overlay;
    }
    if (overlay.kind === 'line') {
      return { ...overlay, from: local(overlay.from), to: local(overlay.to) };
    }
    if (overlay.kind === 'polyline') {
      return { ...overlay, points: overlay.points.map(local) };
    }
    if (overlay.kind === 'circle') {
      return { ...overlay, center: local(overlay.center) };
    }
    if (overlay.kind === 'rect') {
      return { ...overlay, origin: local(overlay.origin) };
    }
    return { ...overlay, origin: local(overlay.origin) };
  });
}

/** 角色图例：role 用作 testID 片段（skia-fixture-overlay-role-{role}），space 标明语义 */
export const FIXTURE_OVERLAY_ROLE_LEGEND = [
  { role: 'selection-box', space: 'world', label: '选框：world 虚线矩形（顶点随视口投影，线宽/虚线屏幕恒定）' },
  { role: 'selection-handle', space: 'world', label: '手柄：选框四角 world 圆点（圆心随视口，半径屏幕恒定）' },
  { role: 'lasso-preview', space: 'world', label: '套索预览：world 闭合虚线多边形' },
  { role: 'cursor', space: 'screen', label: '光标：screen 实心小圆（固定屏幕位置）' },
  { role: 'eraser', space: 'screen', label: '橡皮指示：screen 虚线大圆（固定屏幕位置）' },
  { role: 'zoom-feedback', space: 'screen', label: '缩放反馈：screen 百分比文本 + 基准线' },
  { role: 'angle-feedback', space: 'screen', label: '角度反馈：screen 角度文本 + 45° 方向线' },
  { role: 'ruler', space: 'screen', label: '尺子：screen 填充条带 + 主/次刻度线' },
] as const;
