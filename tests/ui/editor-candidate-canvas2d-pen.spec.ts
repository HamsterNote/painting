import { chromium, expect, type Browser, type Locator, type Page, test } from '@playwright/test';

import {
  countDarkPixels,
  largestNearbyColorCluster,
  readElementCssRegion,
  readElementScreenshot,
  rgb,
  type CssRegion,
} from './canvas2d-pen-pixel-helpers';

/**
 * `/?perf=1&perfRenderer=canvas2d-pen` 的 Web Canvas2D 增量 pen 预览有界像素 E2E。
 *
 * 验证范围（真实 100k production perf workload + 真实 Chromium、dSF=1/2 独立 context）：
 *  - 金丝雀 backend 健康、物理 canvas 数为 2、workload 确实为 100_000 笔；
 *  - pen 手势中 #2563EB 的 Canvas2D 预览蓝线真实存在于独立顶层 2D canvas；
 *  - 抬笔后预览按「保留到 world frame 提交后 2 rAF」策略保留再清除（DOM 状态机 + 逐帧像素采样）；
 *  - 清除后蓝线消失（预览 canvas 自身 readback 归零），且 world 层出现新提交的深色笔迹
 *    （对手势前 baseline 的邻域深色像素差分，host 合成截图仅作采样区间证据）；
 *  - 提交后文档计数、undo/redo、以及取消（window blur）不写历史、不留残影；
 *  - pointerup 后立即开始的「快速第二笔」不会被上一笔的延迟保留清除误擦（实例身份隔离）；
 *  - 非 pen 的 rect 草稿仍由 Skia world 层渲染（Canvas2D 未接管），提交后可观察。
 *
 * 重要边界声明（证据强度，架构复核后收紧）：
 *  - 这是功能像素证据，不是性能测量、不是 native 验证、不是逐像素等价、不是无抗锯齿误差保证；
 *  - RN Skia 的公开 API 没有可确认的「已 present 到屏幕」回调；`makeImageSnapshot` 会主动发起
 *    draw，不能作为「屏幕已呈现」的证明。因此本文件所有 `locator.screenshot()` 一律只当作
 *    **采样区间证据**，不声称绝对零空帧、不声称 world 层（WebGL）每一帧都可见；
 *  - `data-commit-clear-policy` 的「world frame 提交后 + 2 rAF」是产品如实上报的**保守延迟**，
 *    不是可见性证明；本文件据此断言的是状态机顺序与采样到的像素，而非「屏幕已 present」；
 *  - 100k workload 自带大量深色可见笔迹，背景具有歧义；因此提交笔迹只断言「手势前 baseline
 *    邻域 vs 提交后邻域」的深色像素增量，而不是绝对颜色/形状等价；
 *  - 蓝色预览的判定改为读**预览 canvas 自身**的既有 2D 上下文 getImageData（`region=null` 读整块、
 *    否则读有界走廊）：它不经截图合成，天然排除 world 与尺子/UI 的蓝色，避免把 UI 蓝色误判为
 *    预览残留。该 readback 只在 backend 初始化后调用，无参 getContext 返回既有上下文、不改状态；
 *    读回失败一律抛错而非放宽阈值。
 *  - 交接帧检测分两层：页面内 rAF 逐帧 getImageData 读**预览 2D canvas**（非截图、无截图扰动，
 *    但仍是采样）；world 层无法逐帧 readback，故只能靠提交后的**采样区间**截图证明「清除后
 *    world 确有新深色笔迹」。本文件不因此声称任何时刻都无空白帧。
 *  - 蓝色预览（`#2563EB`）与提交后的深色笔迹（默认 `#202124` / workload `#172033`）用不同
 *    检测器区分并注明来源：蓝色取预览 canvas 自身 readback 的蓝色像素，深色取截图邻域暗像素增量。
 *  - 非 pen 的 rect 草稿用 **world canvas 元素截图**（不含尺子等 DOM 浮层）判定 Skia 蓝色草稿。
 *  - 不修改任何产品源码、perf runner、gate 或阈值。
 */

const TEST_ID = {
  root: 'editor-candidate-root',
  canvas: 'editor-candidate-canvas',
  count: 'editor-candidate-count',
  history: 'editor-candidate-history',
  status: 'editor-candidate-status',
  undo: 'editor-candidate-undo',
  redo: 'editor-candidate-redo',
  performanceDiagnostics: 'editor-candidate-performance-diagnostics',
  canary: 'editor-candidate-canvas2d-pen-canary',
} as const;

const CANVAS2D_PEN_PATH = '/?perf=1&perfRenderer=canvas2d-pen';

/** Canvas2D 预览后端声明的蓝色（`PEN_PREVIEW_COLOR`）。 */
const PREVIEW_BLUE = rgb('#2563EB');
/** 预览蓝线为 2 DIP dash [5,4]，最大连通簇阈值取保守小值即可证明连续信号。 */
const PREVIEW_BLUE_MIN_CLUSTER = 4;
/** 提交笔迹相对 baseline 的深色像素最小增量（100k 背景有歧义，故用差分而非绝对值）。 */
const COMMITTED_DARK_MIN_DELTA = 15;

const WORKLOAD_STROKE_COUNT = 100_000;

type CanvasFraction = Readonly<{ fx: number; fy: number }>;

/** pen 主手势路径（避开画布顶部尺子/浮层区域）。 */
const PEN_PATH: readonly CanvasFraction[] = [
  { fx: 0.28, fy: 0.46 },
  { fx: 0.42, fy: 0.5 },
  { fx: 0.55, fy: 0.47 },
  { fx: 0.64, fy: 0.52 },
];

/** 取消用例的 pen 路径（选择另一个区域，避免与主手势邻域混淆）。 */
const CANCEL_PEN_PATH: readonly CanvasFraction[] = [
  { fx: 0.68, fy: 0.62 },
  { fx: 0.8, fy: 0.66 },
];

/** rect 草稿路径（非 pen，用于验证 Skia world 层草稿仍可见）。 */
const RECT_PATH: readonly CanvasFraction[] = [
  { fx: 0.3, fy: 0.58 },
  { fx: 0.52, fy: 0.72 },
];

/** 快速第二笔竞态的两段 pen 路径（各自独立区域，便于区分蓝线归属与世界层提交）。 */
const RAPID_STROKE_A: readonly CanvasFraction[] = [
  { fx: 0.14, fy: 0.74 },
  { fx: 0.2, fy: 0.78 },
  { fx: 0.28, fy: 0.76 },
];
const RAPID_STROKE_B: readonly CanvasFraction[] = [
  { fx: 0.55, fy: 0.78 },
  { fx: 0.62, fy: 0.82 },
  { fx: 0.7, fy: 0.8 },
];

interface HandoffSample {
  blue: number;
  commitClear: string;
}

interface HandoffSampler {
  samples: HandoffSample[];
  stopped: boolean;
}

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function atFraction(box: CanvasBox, fraction: CanvasFraction): { x: number; y: number } {
  return { x: box.x + box.width * fraction.fx, y: box.y + box.height * fraction.fy };
}

/** 读取任意 locator 的可操作 bounding box；不可用时直接失败。 */
async function locatorBox(locator: Locator): Promise<CanvasBox> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('元素没有可用的 bounding box');
  }
  return box;
}

/** 读取画布 host 的可操作 bounding box；不可用时直接失败。 */
async function canvasBox(page: Page): Promise<CanvasBox> {
  return locatorBox(page.getByTestId(TEST_ID.canvas));
}

/**
 * Skia world canvas（无 `data-perf-canvas-layer` 的 canvas）。它是 WebGL 画布，其元素截图
 * 仅包含 world 渲染结果，不含尺子等 DOM 浮层；用于隔离验证非 pen（rect）草稿。注意它仍是
 * `locator.screenshot()`（无 presented 回调、makeImageSnapshot 会主动 draw），只是采样证据。
 */
function worldCanvas(page: Page): Locator {
  return page.getByTestId(TEST_ID.canvas).locator('canvas:not([data-perf-canvas-layer])').first();
}

/** 顶层透明 Canvas2D 预览 canvas 的自身 readback（非截图合成）。 */
interface PreviewCanvasPixels {
  nontransparent: number;
  blue: number;
}

/**
 * 读取预览 canvas 自身的 backing 像素（透明顶层 2D 上下文），绝不经过截图合成、因此不包含
 * world/UI 像素。`region` 为 null 时读取整块 canvas，否则读取相对 canvas 原点的有界走廊。
 *
 * 只在 backend 已初始化后调用：此时 2D 上下文已由后端以 `{ alpha: true }` 创建，
 * `getContext('2d')` 无参调用只会返回既有上下文，不会重建或改变其状态。上下文缺失/读回失败
 * 一律抛错（fail visibly），绝不静默退回放宽阈值。
 */
async function readPreviewCanvasPixels(
  page: Page,
  region: CssRegion | null
): Promise<PreviewCanvasPixels> {
  return page.evaluate((sampleRegion) => {
    const preview = document.querySelector(
      'canvas[data-perf-canvas-layer="canvas2d-pen"]'
    ) as HTMLCanvasElement | null;
    if (!preview) {
      throw new Error(
        '预览 canvas readback 失败：找不到 canvas[data-perf-canvas-layer="canvas2d-pen"]'
      );
    }
    // 无参 getContext 返回后端已创建的既有上下文；不传属性、不改样式，避免任何上下文变更。
    const context = preview.getContext('2d');
    if (!context) {
      throw new Error('预览 canvas readback 失败：既有 2D 上下文不可用');
    }
    const scaleX = preview.width / preview.clientWidth;
    const scaleY = preview.height / preview.clientHeight;
    let left = 0;
    let top = 0;
    let width = preview.width;
    let height = preview.height;
    if (sampleRegion) {
      left = Math.max(0, Math.floor(sampleRegion.x * scaleX));
      top = Math.max(0, Math.floor(sampleRegion.y * scaleY));
      width = Math.max(1, Math.min(preview.width - left, Math.ceil(sampleRegion.width * scaleX)));
      height = Math.max(1, Math.min(preview.height - top, Math.ceil(sampleRegion.height * scaleY)));
    }
    const data = context.getImageData(left, top, width, height).data;
    let nontransparent = 0;
    let blue = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0) {
        nontransparent += 1;
        if (
          Math.abs(data[index] - 37) <= 60 &&
          Math.abs(data[index + 1] - 99) <= 60 &&
          Math.abs(data[index + 2] - 235) <= 60
        ) {
          blue += 1;
        }
      }
    }
    return { nontransparent, blue };
  }, region);
}

/** 手势路径在元素本地 CSS 坐标系中的包围盒（含 padding），用于邻域像素断言。 */
function pathRegion(box: CanvasBox, path: readonly CanvasFraction[], padding: number): CssRegion {
  const points = path.map((fraction) => atFraction(box, fraction));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const x = Math.max(0, minX - box.x - padding);
  const y = Math.max(0, minY - box.y - padding);
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  if (width <= 0 || height <= 0) {
    throw new Error('手势路径区域无效');
  }
  return { x, y, width, height };
}

/**
 * 在画布上按下并沿路径移动，但**不**抬笔；返回显式抬笔函数。
 * 这样测试可以在 pointerup 之前断言预览像素、并在抬笔前后采样交接帧。
 */
async function beginDragPath(
  page: Page,
  path: readonly CanvasFraction[],
  steps: number
): Promise<() => Promise<void>> {
  const box = await canvasBox(page);
  const points = path.map((fraction) => atFraction(box, fraction));
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps });
  }
  return async () => {
    await page.mouse.up();
  };
}

/**
 * 有界等待若干个动画帧（非固定 sleep）：给「被取消的延迟清除 effect」一次真正运行的机会，
 * 若身份隔离失效，陈旧清除会在这几帧内擦掉新一笔的预览。
 */
async function waitAnimationFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let remaining = count;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
          } else {
            window.requestAnimationFrame(step);
          }
        };
        window.requestAnimationFrame(step);
      }),
    frames
  );
}

/**
 * 在 host 上同步派发一段或多段合成 pen 手势（全部在同一个事件任务内完成）。
 *
 * 用途：`page.mouse` 每个动作都有协议往返，无法可靠地在 pointerup 与下一笔 pointerdown 之间
 * 抢在 2 rAF 清除之前；合成 PointerEvent 让「快速第二笔」与上一笔的提交发生在同一任务里，
 * 从而确定性地覆盖「延迟保留清除 vs 新一笔」的身份隔离竞态。合成事件仍走真实 adapter 的
 * pointerdown/move/up 监听与 core 路径，只改变时序、不改变产品语义。
 */
async function dispatchSyntheticSequence(
  page: Page,
  gestures: readonly Readonly<{ path: readonly CanvasFraction[]; release: boolean }>[],
  pointerId: number
): Promise<void> {
  const box = await canvasBox(page);
  const payloadGestures = gestures.map((gesture) => ({
    release: gesture.release,
    points: gesture.path.map((fraction) => {
      const point = atFraction(box, fraction);
      return { x: point.x - box.x, y: point.y - box.y };
    }),
  }));
  await page.evaluate(
    (payload) => {
      const host = document.querySelector('[data-testid="editor-candidate-canvas"]');
      if (!host) {
        throw new Error('派发合成手势失败：找不到 editor-candidate-canvas');
      }
      const fire = (type: string, x: number, y: number, buttons: number) => {
        const rect = host.getBoundingClientRect();
        host.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: payload.pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons,
            // 真实 pen 压力：按下/移动 0.5、抬起 0。缺失该字段会默认为 0，使 core 归一化后
            // 保留 0 压力，进而令 Skia 提交笔迹宽度归零（Canvas2D 预览是固定宽度，两者不一致）。
            pressure: type === 'pointerup' ? 0 : 0.5,
            clientX: rect.left + x,
            clientY: rect.top + y,
          })
        );
      };
      for (const gesture of payload.gestures) {
        const [first, ...rest] = gesture.points;
        fire('pointerdown', first.x, first.y, 1);
        for (const point of rest) {
          fire('pointermove', point.x, point.y, 1);
        }
        if (gesture.release) {
          const last = gesture.points[gesture.points.length - 1];
          fire('pointerup', last.x, last.y, 0);
        }
      }
    },
    { gestures: payloadGestures, pointerId }
  );
}

/** 只派发一次 pointerup，用于结束一段仍按下的合成手势。 */
async function dispatchSyntheticPointerUp(
  page: Page,
  path: readonly CanvasFraction[],
  pointerId: number
): Promise<void> {
  const box = await canvasBox(page);
  const lastFraction = path[path.length - 1];
  const point = atFraction(box, lastFraction);
  await page.evaluate(
    (payload) => {
      const host = document.querySelector('[data-testid="editor-candidate-canvas"]');
      if (!host) {
        throw new Error('派发合成 pointerup 失败：找不到 editor-candidate-canvas');
      }
      const rect = host.getBoundingClientRect();
      host.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: payload.pointerId,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
          // 抬笔压力为 0，与 down/move 的 0.5 保持一致的 realistic pen 语义。
          pressure: 0,
          clientX: rect.left + payload.x,
          clientY: rect.top + payload.y,
        })
      );
    },
    { x: point.x - box.x, y: point.y - box.y, pointerId }
  );
}

/** 合成 pen 手势使用的独立 pointerId，避免与 `page.mouse` 的真实 pointer 冲突。 */
const SYNTHETIC_POINTER_ID = 41;

/** 通过稳定 testID 选择工具；工具切换本身绝不写入 history。 */
async function selectTool(page: Page, toolSuffix: string): Promise<void> {
  await page.getByTestId(`editor-candidate-tool-${toolSuffix}`).click();
}

/** 在 canary 节点上安装 data-commit-clear 的 MutationObserver 序列记录。 */
async function installCommitClearRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="editor-candidate-canvas2d-pen-canary"]');
    const sequence: string[] = [];
    (window as unknown as { __canvas2dPenCommitClearSeq?: string[] }).__canvas2dPenCommitClearSeq =
      sequence;
    if (!node) {
      return;
    }
    sequence.push(node.getAttribute('data-commit-clear') ?? 'unknown');
    const observer = new MutationObserver(() => {
      sequence.push(node.getAttribute('data-commit-clear') ?? 'unknown');
    });
    observer.observe(node, { attributes: true, attributeFilter: ['data-commit-clear'] });
  });
}

/** 读取记录到的 commit-clear 状态序列（不去重，保序）。 */
async function readCommitClearSequence(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __canvas2dPenCommitClearSeq?: string[] })
        .__canvas2dPenCommitClearSeq ?? []
  );
}

/**
 * 安装非阻塞的逐帧预览采样器：每帧读取独立 2D 预览 canvas 的指定区域，统计近似蓝色像素，
 * 并同时记录当时 canary 的 data-commit-clear。采样在页面内用 rAF 驱动，不产生截图扰动。
 */
async function installHandoffSampler(page: Page, region: CssRegion): Promise<void> {
  await page.evaluate((sampleRegion) => {
    const canary = document.querySelector('[data-testid="editor-candidate-canvas2d-pen-canary"]');
    const preview = document.querySelector(
      'canvas[data-perf-canvas-layer="canvas2d-pen"]'
    ) as HTMLCanvasElement | null;
    const sampler: HandoffSampler = { samples: [], stopped: false };
    (
      window as unknown as { __canvas2dPenHandoffSampler?: HandoffSampler }
    ).__canvas2dPenHandoffSampler = sampler;

    const context = preview?.getContext('2d') ?? null;
    if (!preview || !canary || !context) {
      sampler.stopped = true;
      return;
    }
    const scaleX = preview.width / preview.clientWidth;
    const scaleY = preview.height / preview.clientHeight;
    const left = Math.max(0, Math.floor(sampleRegion.x * scaleX));
    const top = Math.max(0, Math.floor(sampleRegion.y * scaleY));
    const width = Math.max(
      1,
      Math.min(preview.width - left, Math.ceil(sampleRegion.width * scaleX))
    );
    const height = Math.max(
      1,
      Math.min(preview.height - top, Math.ceil(sampleRegion.height * scaleY))
    );

    const sample = () => {
      if (sampler.stopped) {
        return;
      }
      sampler.samples.push({
        blue: countBluePixels(context, left, top, width, height),
        commitClear: canary.getAttribute('data-commit-clear') ?? 'unknown',
      });
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);

    function countBluePixels(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number
    ): number {
      let blue = 0;
      try {
        const data = ctx.getImageData(x, y, w, h).data;
        for (let index = 0; index < data.length; index += 4) {
          if (
            data[index + 3] > 0 &&
            Math.abs(data[index] - 37) <= 60 &&
            Math.abs(data[index + 1] - 99) <= 60 &&
            Math.abs(data[index + 2] - 235) <= 60
          ) {
            blue += 1;
          }
        }
      } catch {
        // 上下文暂不可读时按 0 处理；若持续为 0，断言会显式失败而不是被静默跳过。
      }
      return blue;
    }
  }, region);
}

/** 停止采样并取回全部样本。 */
async function readHandoffSamples(page: Page): Promise<HandoffSample[]> {
  return page.evaluate(() => {
    const sampler = (window as unknown as { __canvas2dPenHandoffSampler?: HandoffSampler })
      .__canvas2dPenHandoffSampler;
    if (!sampler) {
      return [];
    }
    sampler.stopped = true;
    return sampler.samples;
  });
}

/** 断言某张 readback 的 CSS 倍率与目标 dSF 一致（读回缩放可信）。 */
function expectDeviceScale(
  readback: { pixelsPerCssX: number; pixelsPerCssY: number },
  dsf: number
) {
  expect(Math.abs(readback.pixelsPerCssX - dsf)).toBeLessThan(0.06);
  expect(Math.abs(readback.pixelsPerCssY - dsf)).toBeLessThan(0.06);
}

/** 单个 dSF 下运行完整 canvas2d-pen 功能像素场景。 */
async function runCanvas2dPenScenario(browser: Browser, deviceScaleFactor: number): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  try {
    const wasmResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
      { timeout: 90_000 }
    );

    await page.goto(CANVAS2D_PEN_PATH);

    const root = page.getByTestId(TEST_ID.root);
    const host = page.getByTestId(TEST_ID.canvas);
    const canary = page.getByTestId(TEST_ID.canary);
    const performanceDiagnostics = page.getByTestId(TEST_ID.performanceDiagnostics);

    await expect(root).toBeVisible({ timeout: 90_000 });
    await expect(host).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('editor-candidate-route-error')).not.toBeVisible();

    // 真实 100k production workload 已就绪且 frame 可用。
    await expect(performanceDiagnostics).toHaveAttribute(
      'data-workload-strokes',
      String(WORKLOAD_STROKE_COUNT),
      {
        timeout: 120_000,
      }
    );
    await expect(performanceDiagnostics).toHaveAttribute('data-workload-ready', 'true', {
      timeout: 120_000,
    });
    await expect(performanceDiagnostics).toHaveAttribute('data-frame-ready', 'true', {
      timeout: 120_000,
    });
    await expect(performanceDiagnostics).toHaveAttribute('data-perf-renderer', 'canvas2d-pen');

    // 金丝雀：backend 已挂载、健康、真实物理 canvas 数为 2，并如实上报保守清除策略。
    await expect(canary).toHaveAttribute('data-backend-mounted', 'true', { timeout: 120_000 });
    await expect(canary).toHaveAttribute('data-healthy', 'true');
    await expect(canary).toHaveAttribute('data-physical-canvas-count', '2');
    await expect(canary).toHaveAttribute(
      'data-commit-clear-policy',
      /retain-until-world-frame-commit-plus-2raf/
    );

    const wasm = await wasmResponse;
    expect(new URL(wasm.url()).origin).toBe(new URL(page.url()).origin);
    expect(wasm.status()).toBe(200);
    expect(wasm.headers()['content-type']).toContain('application/wasm');

    // 物理 2 canvas：Skia world canvas + 顶层透明 Canvas2D 预览 canvas。
    await expect(page.locator('canvas')).toHaveCount(2);
    await expect(page.locator('canvas[data-perf-canvas-layer="canvas2d-pen"]')).toBeVisible();

    await selectTool(page, 'pen');
    const box = await canvasBox(page);
    const penRegion = pathRegion(box, PEN_PATH, 14);

    // 手势前 baseline：邻域深色像素基线（100k 背景中可能已有零星深色笔迹）。
    const baselineHost = await readElementScreenshot(host);
    expectDeviceScale(baselineHost, deviceScaleFactor);
    const baselineRegion = readElementCssRegion(baselineHost, penRegion, 'pen baseline');
    const baselineDark = countDarkPixels(baselineRegion);
    // 手势前预览 canvas 必须完全透明（自身 readback，不经截图合成）。
    expect((await readPreviewCanvasPixels(page, null)).nontransparent).toBe(0);

    // ---- pen 手势进行中：预览蓝线存在于独立 Canvas2D 层（自身 canvas readback）----
    const finishPen = await beginDragPath(page, PEN_PATH, 12);
    await expect(canary).toHaveAttribute('data-preview-active', 'true');
    await expect(canary).toHaveAttribute('data-physical-canvas-count', '2');

    const previewDuring = await readPreviewCanvasPixels(page, penRegion);
    expect(previewDuring.blue).toBeGreaterThanOrEqual(PREVIEW_BLUE_MIN_CLUSTER);
    expect(previewDuring.nontransparent).toBeGreaterThanOrEqual(PREVIEW_BLUE_MIN_CLUSTER);

    // ---- 交接：安装状态记录 + 逐帧像素采样，然后抬笔 ----
    await installCommitClearRecorder(page);
    await installHandoffSampler(page, penRegion);
    await finishPen();

    // 状态机最终到达 'cleared'（保守延迟策略的状态信号，不是「屏幕已 present」的证明）。
    await expect(canary).toHaveAttribute('data-commit-clear', 'cleared', { timeout: 30_000 });

    const samples = await readHandoffSamples(page);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    // 逐帧采样确实看到了预览蓝线（采样器工作且手势期间预览可见）。
    expect(samples.some((sample) => sample.blue > 0)).toBe(true);
    // 像素级保留：存在 data-commit-clear=retained 的同时预览仍含蓝色的采样帧。
    expect(samples.some((sample) => sample.commitClear === 'retained' && sample.blue > 0)).toBe(
      true
    );
    /**
     * 诚实边界：clear() 在 rAF 内同步清空预览，而 React 的 data-commit-clear='cleared'
     * 状态刷新可能晚一帧，因此「retained 且 blue=0」的过渡帧是可能存在的，且此时 world frame
     * 早已提交（并非空白）。这里只断言不存在「blue=0 且 marker 既非 retained 也非 cleared」
     * （即 idle，表示手势已开始却完全看不到预览）的采样帧；world 层是 WebGL，无法逐帧 readback，
     * 故本文件不声称已证明 world 层零空白帧。
     */
    expect(samples.filter((sample) => sample.blue === 0 && sample.commitClear === 'idle')).toEqual(
      []
    );

    const sequence = await readCommitClearSequence(page);
    const retainedIndex = sequence.indexOf('retained');
    const clearedIndex = sequence.indexOf('cleared');
    expect(retainedIndex).toBeGreaterThanOrEqual(0);
    expect(clearedIndex).toBeGreaterThan(retainedIndex);

    // ---- 清除后：预览 canvas 自身 readback 归零；world 层出现新提交的深色笔迹 ----
    await expect(canary).toHaveAttribute('data-preview-active', 'false');
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 1}`
    );

    // 蓝色预览只存在于预览 canvas：清除后整块预览 canvas 必须零非透明像素（不经截图合成，
    // 因此不会把尺子引导线/UI 的蓝色误判为预览残留）。
    const afterPreview = await readPreviewCanvasPixels(page, null);
    expect(afterPreview.nontransparent).toBe(0);
    expect(afterPreview.blue).toBe(0);

    // 深色提交笔迹：host 截图是 world+预览的合成采样，只用于深色像素差分，不用于蓝色判定。
    const afterHost = await readElementScreenshot(host);
    const afterRegion = readElementCssRegion(afterHost, penRegion, 'pen committed');
    const afterDark = countDarkPixels(afterRegion);
    expect(afterDark).toBeGreaterThan(baselineDark + COMMITTED_DARK_MIN_DELTA);

    // ---- 提交后历史：undo/redo 精确往返 ----
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 0');
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText(`笔迹 ${WORKLOAD_STROKE_COUNT}`);
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 1');
    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 1}`
    );
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 0');

    // ---- 非 pen 的 rect 草稿仍由 Skia world 层渲染（Canvas2D 未接管），提交后可观察 ----
    // world canvas 元素截图仅含 WebGL world 内容，不含尺子等 DOM 浮层，避免 UI 蓝色误判。
    await selectTool(page, 'rect');
    const world = worldCanvas(page);
    const worldBox = await locatorBox(world);
    const rectRegion = pathRegion(worldBox, RECT_PATH, 16);
    const rectBaselineShot = await readElementScreenshot(world);
    expectDeviceScale(rectBaselineShot, deviceScaleFactor);
    const rectBaselineRegion = readElementCssRegion(rectBaselineShot, rectRegion, 'rect baseline');
    const rectBaselineDark = countDarkPixels(rectBaselineRegion);
    expect(largestNearbyColorCluster(rectBaselineRegion, PREVIEW_BLUE, 56)).toBeLessThanOrEqual(1);

    const finishRect = await beginDragPath(page, RECT_PATH, 10);
    // rect 不触发 Canvas2D pen 预览，蓝框来自 Skia world overlay。
    await expect(canary).toHaveAttribute('data-preview-active', 'false');
    const rectDuringRegion = readElementCssRegion(
      await readElementScreenshot(world),
      rectRegion,
      'rect draft'
    );
    expect(largestNearbyColorCluster(rectDuringRegion, PREVIEW_BLUE, 56)).toBeGreaterThanOrEqual(
      PREVIEW_BLUE_MIN_CLUSTER
    );
    await finishRect();

    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 2}`
    );
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 2 · Redo depth 0');
    const rectAfterRegion = readElementCssRegion(
      await readElementScreenshot(world),
      rectRegion,
      'rect committed'
    );
    expect(largestNearbyColorCluster(rectAfterRegion, PREVIEW_BLUE, 56)).toBeLessThanOrEqual(1);
    expect(countDarkPixels(rectAfterRegion)).toBeGreaterThan(
      rectBaselineDark + COMMITTED_DARK_MIN_DELTA
    );

    // undo 回 pen 之后的 1 条状态，redo 回到 rect 提交后的 2 条状态。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 1}`
    );
    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 2}`
    );

    // ---- pointerup 快速第二笔：上一笔的延迟保留清除绝不能擦掉新一笔预览 ----
    await selectTool(page, 'pen');
    const rapidRegionA = pathRegion(box, RAPID_STROKE_A, 14);
    const rapidRegionB = pathRegion(box, RAPID_STROKE_B, 14);
    const rapidBaselineHost = await readElementScreenshot(host);
    const rapidBaselineDarkA = countDarkPixels(
      readElementCssRegion(rapidBaselineHost, rapidRegionA, 'rapid baseline A')
    );
    const rapidBaselineDarkB = countDarkPixels(
      readElementCssRegion(rapidBaselineHost, rapidRegionB, 'rapid baseline B')
    );
    // 快速第二笔开始前，预览 canvas 应已完全透明（上一笔已清除）。
    expect((await readPreviewCanvasPixels(page, null)).nontransparent).toBe(0);

    // 同一事件任务内：第一笔完整画完并抬笔 + 立即按下第二笔（早于上一笔的 2 rAF 延迟清除）。
    await dispatchSyntheticSequence(
      page,
      [
        { path: RAPID_STROKE_A, release: true },
        { path: RAPID_STROKE_B, release: false },
      ],
      SYNTHETIC_POINTER_ID
    );
    await expect(canary).toHaveAttribute('data-preview-active', 'true');
    // 有界等待若干帧，让被取消的延迟清除 effect 有机会真正运行。
    await waitAnimationFrames(page, 8);

    // 预览自身 readback：第二笔蓝线落在第二笔区域；第一笔已提交，其区域不应有蓝线残留。
    const rapidPreviewA = await readPreviewCanvasPixels(page, rapidRegionA);
    const rapidPreviewB = await readPreviewCanvasPixels(page, rapidRegionB);
    expect(rapidPreviewA.nontransparent).toBeLessThanOrEqual(1);
    expect(rapidPreviewB.blue).toBeGreaterThanOrEqual(PREVIEW_BLUE_MIN_CLUSTER);
    expect(rapidPreviewB.nontransparent).toBeGreaterThanOrEqual(PREVIEW_BLUE_MIN_CLUSTER);

    await dispatchSyntheticPointerUp(page, RAPID_STROKE_B, SYNTHETIC_POINTER_ID);
    // 两笔都已提交（+2），且最终清除。
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 4}`
    );
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 4 · Redo depth 0');
    await expect(canary).toHaveAttribute('data-commit-clear', 'cleared', { timeout: 30_000 });

    // 预览自身 readback 归零；深色提交笔迹仍用 host 合成截图做邻域差分（采样区间证据）。
    expect((await readPreviewCanvasPixels(page, null)).nontransparent).toBe(0);
    const rapidAfterHost = await readElementScreenshot(host);
    const rapidAfterA = readElementCssRegion(rapidAfterHost, rapidRegionA, 'rapid committed A');
    const rapidAfterB = readElementCssRegion(rapidAfterHost, rapidRegionB, 'rapid committed B');
    expect(countDarkPixels(rapidAfterA)).toBeGreaterThan(
      rapidBaselineDarkA + COMMITTED_DARK_MIN_DELTA
    );
    expect(countDarkPixels(rapidAfterB)).toBeGreaterThan(
      rapidBaselineDarkB + COMMITTED_DARK_MIN_DELTA
    );

    // ---- 取消：window blur 触发 pointer cancel，不写历史、预览蓝线不留残影 ----
    await selectTool(page, 'pen');
    const finishCancel = await beginDragPath(page, CANCEL_PEN_PATH, 8);
    await expect(canary).toHaveAttribute('data-preview-active', 'true');
    const cancelPreview = await readPreviewCanvasPixels(page, null);
    expect(cancelPreview.blue).toBeGreaterThanOrEqual(PREVIEW_BLUE_MIN_CLUSTER);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('指针已取消');
    await expect(page.getByTestId(TEST_ID.count)).toContainText(
      `笔迹 ${WORKLOAD_STROKE_COUNT + 4}`
    );
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 4 · Redo depth 0');
    await expect(canary).toHaveAttribute('data-preview-active', 'false');
    expect((await readPreviewCanvasPixels(page, null)).nontransparent).toBe(0);
    // 释放仍然按下的鼠标；适配器已删除该 pointerId，up 会被忽略。
    await finishCancel();
  } finally {
    await context.close();
  }
}

test.describe('canvas2d-pen 增量 pen 预览像素 E2E', () => {
  /**
   * P0：dSF=1/2 独立 context 下的 canvas2d-pen 功能像素证据。
   *
   * 覆盖：健康/物理 2 canvas/100k workload、抬手前蓝色预览、保留-清除状态机、提交后深色笔迹
   * 差分、undo/redo、pointerup 快速第二笔的身份隔离、window blur 取消无残影、rect 非 pen 草稿。
   *
   * 只证明本次 Chromium screenshot/readback（采样区间证据）与页面内 rAF 预览层 readback；
   * RN Skia 无公开 presented 回调、`makeImageSnapshot` 会主动 draw，故不声称 world 层已 present
   * 或不含任何空白帧。它是功能验证，不是性能基线、不是 native 结论。每个 dSF 使用独立 context，
   * 避免 DPR/缩放状态泄漏。
   */
  test('P0：dSF=1/2 的 100k 候选 pen 预览/保留/提交/取消像素证据', async () => {
    test.setTimeout(600_000);
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    });
    try {
      for (const deviceScaleFactor of [1, 2]) {
        await runCanvas2dPenScenario(browser, deviceScaleFactor);
      }
    } finally {
      await browser.close();
    }
  });
});
