/// <reference types="jest" />
/**
 * PenPreviewCanvasBackend 的聚焦单测（mock 2D canvas/context，无 DOM/React/Skia）。
 *
 * 覆盖增量语义、精度重定基、DPR/CSS DIP、dash 连续性（含 lineDashOffset 相位方向）、
 * 去重 no-op、epoch/cancel/dispose、前缀失效 fail-safe、backing 有效性、context loss
 * 以及「只有显式失效才全量回放且不伪装计数」；不触发浏览器、不构建。
 */
import type { DrawingFrame, DrawingPointV2 } from '@hamster-note/painting/core';
import {
  PEN_PREVIEW_COLOR,
  PEN_PREVIEW_DASH_DIP,
  PEN_PREVIEW_MAX_BACKING_DIMENSION,
  PEN_PREVIEW_STROKE_WIDTH_DIP,
  PenPreviewCanvasBackend,
} from './penPreviewCanvas.web';

/** 记录一次 stroke 的端点、dash offset 与描边样式，用于断言绘制语义。 */
type StrokeRecord = {
  points: { x: number; y: number }[];
  lineDashOffset: number;
  lineWidth: number;
  strokeStyle: string;
  lineCap: string;
  lineJoin: string;
};

interface MockContext2D {
  lineCap: string;
  lineJoin: string;
  lineWidth: number;
  strokeStyle: string;
  lineDashOffset: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  setLineDash(values: number[]): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  isContextLost(): boolean;
}

function createMockContext(contextLost = false) {
  const strokes: StrokeRecord[] = [];
  const clearRects: { x: number; y: number; w: number; h: number }[] = [];
  const setLineDashCalls: number[][] = [];
  const transforms: number[][] = [];
  let current: { x: number; y: number }[] = [];
  const ctx: MockContext2D = {
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '#000',
    lineDashOffset: 0,
    beginPath() {
      current = [];
    },
    moveTo(x, y) {
      current = [{ x, y }];
    },
    lineTo(x, y) {
      current.push({ x, y });
    },
    stroke() {
      strokes.push({
        points: current.map((point) => ({ ...point })),
        lineDashOffset: ctx.lineDashOffset,
        lineWidth: ctx.lineWidth,
        strokeStyle: ctx.strokeStyle,
        lineCap: ctx.lineCap,
        lineJoin: ctx.lineJoin,
      });
    },
    clearRect(x, y, w, h) {
      clearRects.push({ x, y, w, h });
    },
    setLineDash(values) {
      setLineDashCalls.push([...values]);
    },
    setTransform(a, b, c, d, e, f) {
      transforms.push([a, b, c, d, e, f]);
    },
    isContextLost() {
      return contextLost;
    },
  };
  return { ctx, strokes, clearRects, setLineDashCalls, transforms };
}

function createMockCanvas(width: number, height: number, context: MockContext2D | null) {
  const raw = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: jest.fn((_type: string, _attrs?: unknown) => context),
  };
  return { canvas: raw as unknown as HTMLCanvasElement, raw };
}

/** 构造只含坐标换算所需字段的最小 frame；其余字段与测试无关。 */
function makeFrame(originX = 0, originY = 0, scale = 1, tx = 0, ty = 0): DrawingFrame {
  return {
    frameOrigin: { x: originX, y: originY },
    localToScreen: { a: scale, b: 0, c: 0, d: scale, tx, ty },
  } as unknown as DrawingFrame;
}

function setup(
  frame: DrawingFrame | null = makeFrame(),
  options: { width?: number; height?: number; dpr?: number; context?: MockContext2D | null } = {}
) {
  const mock = createMockContext();
  const context = options.context === undefined ? mock.ctx : options.context;
  const { canvas, raw } = createMockCanvas(options.width ?? 200, options.height ?? 100, context);
  // 未注入 dpr 时由后端读 globalThis.devicePixelRatio（生产行为），测试可显式注入。
  const backend = new PenPreviewCanvasBackend({
    canvas,
    getFrame: () => frame,
    dpr: options.dpr,
  });
  return { backend, mock, raw };
}

function totalLineTo(mock: ReturnType<typeof createMockContext>): number {
  return mock.strokes.reduce((sum, stroke) => sum + (stroke.points.length - 1), 0);
}

describe('PenPreviewCanvasBackend', () => {
  it('1200 点增量绘制恰好 1199 段，正常路径零全量回放', () => {
    const { backend, mock } = setup();
    const points: DrawingPointV2[] = [{ x: 0, y: 0 }];
    expect(backend.begin(1, points)).toBe(true);
    for (let index = 1; index < 1200; index += 1) {
      points.push({ x: index, y: index % 7 });
      expect(backend.append(1, points)).toBe(true);
    }
    const counters = backend.getCounters();
    expect(counters.segmentDrawCount).toBe(1199);
    expect(counters.fullReplayCount).toBe(0);
    expect(counters.healthy).toBe(true);
    expect(totalLineTo(mock)).toBe(1199);
  });

  it('±1e9 附近先按 frameOrigin 重定基再投影，保留 .125 级精度', () => {
    const frame = makeFrame(1e9, -1e9, 1);
    const { backend, mock } = setup(frame);
    expect(
      backend.begin(1, [
        { x: 1e9 + 0.125, y: -1e9 - 0.25 },
        { x: 1e9 + 0.5, y: -1e9 - 0.5 },
      ])
    ).toBe(true);
    const stroke = mock.strokes.at(-1);
    expect(stroke).toBeDefined();
    expect(stroke?.points[0].x).toBeCloseTo(0.125, 6);
    expect(stroke?.points[0].y).toBeCloseTo(-0.25, 6);
    expect(stroke?.points[1].x).toBeCloseTo(0.5, 6);
    expect(stroke?.points[1].y).toBeCloseTo(-0.5, 6);
    expect(backend.healthy).toBe(true);
  });

  it('超出安全界的投影显式不健康，绝不静默裁剪', () => {
    const { backend } = setup(makeFrame(0, 0, 1));
    // local 1e9 > 1e7 安全界，必须整体失败而非部分成功。
    expect(backend.begin(1, [{ x: 1e9, y: 0 }])).toBe(false);
    expect(backend.healthy).toBe(false);
  });

  it('DPR 1/2 下 CSS DIP 与 backing pixels 对齐，并配置 alpha 与 pointerEvents', () => {
    for (const dpr of [1, 2]) {
      const { backend, mock, raw } = setup(makeFrame(), { width: 120, height: 80, dpr });
      expect(backend.resize()).toBe(true);
      expect(raw.width).toBe(120 * dpr);
      expect(raw.height).toBe(80 * dpr);
      expect(raw.style.width).toBe('120px');
      expect(raw.style.height).toBe('80px');
      expect(raw.style.pointerEvents).toBe('none');
      expect(mock.transforms.at(-1)).toEqual([dpr, 0, 0, dpr, 0, 0]);
      expect(raw.getContext).toHaveBeenCalledWith('2d', { alpha: true });
      expect(mock.setLineDashCalls.at(-1)).toEqual([...PEN_PREVIEW_DASH_DIP]);
    }
  });

  it('分段 stroke 的 lineDashOffset 取正累计相位，dash 跨 append 不重启', () => {
    const { backend, mock } = setup();
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 20, y: 0 };
    backend.begin(1, [p0]);
    expect(backend.append(1, [p0, p1])).toBe(true);
    expect(backend.append(1, [p0, p1, p2])).toBe(true);
    expect(mock.strokes).toHaveLength(2);
    // Canvas2D lineDashOffset 是「进入 pattern 的相位」：路径起点相位等于此前累计长。
    // 首段从 0 开始；第二段起点相位 = 首段累计长 10（正值），若误用负值会反向错位。
    expect(mock.strokes[0].lineDashOffset).toBe(0);
    expect(mock.strokes[1].lineDashOffset).toBeCloseTo(10, 9);
    expect(mock.strokes[1].lineDashOffset).toBeGreaterThan(0);
    // 描边样式与既有 Skia pen 预览一致。
    expect(mock.strokes[0].strokeStyle).toBe(PEN_PREVIEW_COLOR);
    expect(mock.strokes[0].lineWidth).toBe(PEN_PREVIEW_STROKE_WIDTH_DIP);
    expect(mock.strokes[0].lineCap).toBe('round');
    expect(mock.strokes[0].lineJoin).toBe('round');
  });

  it('重复/空 tail 为 no-op，旧 epoch 与未激活状态被忽略', () => {
    const { backend, mock } = setup();
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 5, y: 0 };
    backend.begin(1, [p0, p1]);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    // 相同长度：无新增点。
    expect(backend.append(1, [p0, p1])).toBe(false);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    expect(mock.strokes).toHaveLength(1);
    // 更旧 epoch：旧笔不得复活。
    expect(backend.append(0, [p0, p1, { x: 9, y: 0 }])).toBe(false);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    // clear 后 append 被忽略。
    backend.clear();
    expect(backend.isActive).toBe(false);
    expect(backend.append(1, [p0, p1, { x: 9, y: 0 }])).toBe(false);
    expect(mock.strokes).toHaveLength(1);
  });

  it('新 epoch 重置并清屏，cancel 只清匹配 epoch，dispose 后不健康且拒绝写入', () => {
    const { backend, mock } = setup();
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 5, y: 0 };
    const p2 = { x: 10, y: 0 };
    backend.begin(1, [p0, p1]);
    const clearAfterFirst = mock.clearRects.length;
    // 同 epoch 重复 begin 被拒绝，不得复活/叠加。
    expect(backend.begin(1, [p0, p1, p2])).toBe(false);
    expect(mock.strokes).toHaveLength(1);
    // 新 epoch：清屏并重画首段。
    expect(backend.begin(2, [p0, p1, p2])).toBe(true);
    expect(mock.clearRects.length).toBe(clearAfterFirst + 1);
    expect(backend.isActive).toBe(true);
    expect(backend.cancel(3)).toBe(false);
    expect(backend.isActive).toBe(true);
    expect(backend.cancel(2)).toBe(true);
    expect(backend.isActive).toBe(false);
    backend.dispose();
    expect(backend.healthy).toBe(false);
    expect(backend.append(3, [p0, p1, p2])).toBe(false);
    expect(backend.begin(3, [p0, p1, p2])).toBe(false);
  });

  it('前缀失效时安全替换整条 points 后全量重投影，不遗漏新点', () => {
    const { backend, mock } = setup();
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 5, y: 0 };
    backend.begin(1, [p0, p1]);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    // consumed=2，但 replacement[1] 与已存最后点值不同 → 判定前缀失效。
    const replacement = [
      { x: 100, y: 100 },
      { x: 105, y: 100 },
      { x: 110, y: 100 },
    ];
    expect(backend.append(1, replacement)).toBe(true);
    expect(backend.getCounters().fullReplayCount).toBe(1);
    expect(backend.healthy).toBe(true);
    // 回放画的是替换后的完整 points，而非旧 worldPoints。
    expect(mock.strokes.at(-1)?.points).toEqual(replacement);
    // 回放不计入增量 segment；随后正常 append 仍只消费 tail。
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    expect(backend.append(1, [...replacement, { x: 115, y: 100 }])).toBe(true);
    expect(backend.getCounters().fullReplayCount).toBe(1);
    expect(backend.getCounters().segmentDrawCount).toBe(2);
  });

  it('只有显式 reproject/resize 才全量回放，且回放不计入增量 segment', () => {
    const { backend, mock } = setup();
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    backend.begin(1, [p0]);
    backend.append(1, [p0, p1]);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    expect(backend.getCounters().fullReplayCount).toBe(0);
    const strokesBefore = mock.strokes.length;
    expect(backend.reproject()).toBe(true);
    expect(mock.strokes.length).toBe(strokesBefore + 1);
    expect(backend.getCounters().fullReplayCount).toBe(1);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
    expect(backend.resize()).toBe(true);
    expect(backend.getCounters().fullReplayCount).toBe(2);
    expect(backend.getCounters().segmentDrawCount).toBe(1);
  });

  it('未激活且无点时 reproject/resize 不抬高 fullReplayCount', () => {
    const { backend, mock } = setup();
    expect(backend.reproject()).toBe(true);
    expect(backend.resize()).toBe(true);
    const counters = backend.getCounters();
    expect(counters.fullReplayCount).toBe(0);
    expect(counters.segmentDrawCount).toBe(0);
    expect(counters.healthy).toBe(true);
    expect(mock.strokes).toHaveLength(0);
  });

  it('clientWidth/Height 无效时 backing 不成立且不健康，begin 被拒绝', () => {
    const mock = createMockContext();
    const { canvas, raw } = createMockCanvas(0, 100, mock.ctx);
    const backend = new PenPreviewCanvasBackend({ canvas, getFrame: () => makeFrame() });
    expect(backend.healthy).toBe(false);
    expect(backend.begin(1, [{ x: 0, y: 0 }])).toBe(false);
    expect(raw.width).toBe(0);
  });

  it('DPR 乘法超出 backing 上限时拒绝配置且不健康', () => {
    const { backend, raw } = setup(makeFrame(), { width: 200, height: 100, dpr: 1e6 });
    expect(200 * 1e6).toBeGreaterThan(PEN_PREVIEW_MAX_BACKING_DIMENSION);
    expect(backend.healthy).toBe(false);
    expect(raw.width).toBe(0);
    expect(raw.style.width).toBeUndefined();
  });

  it('DPR 1→2 变化必须经显式 resize 才能正确重设 backing', () => {
    const globalScope = globalThis as { devicePixelRatio?: number };
    const previous = globalScope.devicePixelRatio;
    try {
      globalScope.devicePixelRatio = 1;
      const { backend, raw, mock } = setup(makeFrame());
      expect(raw.width).toBe(200);
      expect(mock.transforms.at(-1)).toEqual([1, 0, 0, 1, 0, 0]);
      globalScope.devicePixelRatio = 2;
      expect(backend.resize()).toBe(true);
      expect(raw.width).toBe(400);
      expect(mock.transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
      expect(backend.healthy).toBe(true);
    } finally {
      if (previous === undefined) {
        delete globalScope.devicePixelRatio;
      } else {
        globalScope.devicePixelRatio = previous;
      }
    }
  });

  it('context 缺失或 DPR 非法时不健康，绝不用回退冒充健康', () => {
    const noContext = setup(makeFrame(), { context: null });
    expect(noContext.backend.healthy).toBe(false);

    const badDpr = setup(makeFrame(), { dpr: 0 });
    expect(badDpr.backend.healthy).toBe(false);
    expect(badDpr.raw.width).toBe(200);
  });

  it('context 丢失时不健康并拒绝写入，恢复路径不得误标健康', () => {
    const mock = createMockContext(true);
    const { canvas } = createMockCanvas(200, 100, mock.ctx);
    const backend = new PenPreviewCanvasBackend({ canvas, getFrame: () => makeFrame() });
    expect(backend.healthy).toBe(false);
    expect(
      backend.begin(1, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toBe(false);
  });

  it('帧缺失时不健康并拒绝 begin，不静默成功', () => {
    const { backend } = setup(null);
    expect(
      backend.begin(1, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toBe(false);
    expect(backend.healthy).toBe(false);
  });
});
