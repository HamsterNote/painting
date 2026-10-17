import { chromium, expect, type Browser, type Locator, type Page, test } from '@playwright/test';

/**
 * `/skia-drawing-fixture` Web 隔离入口的持久 Playwright Chromium E2E（阶段 9 有界证据）。
 *
 * 验证范围（仅真实 Web 浏览器 + 本地 CanvasKit = 真实 CanvasKit，非原生、非 mock）：
 *  - 同源静态资源 `/canvaskit.wasm` 返回 200 且 content-type 为 application/wasm；
 *  - 正常加载后 root / resources / canvas 均存在，且全页仅一个 `<canvas>` 元素；
 *  - 正常流程不产生产品级 console error / pageerror；
 *  - 8 个对象图例、world/screen overlay 角色图例的 DOM 语义存在；
 *  - 视口控制：缩放至 4、向右/向下平移、回中后的稳定状态文本；
 *  - 跳转「远端 50k」与「1e9+0.125」后 frame origin（world DIP）发生改变。
 *
 * 重要边界声明（证据强度）：
 *  - 既有测试只断言 DOM 语义（testID / 可访问文本），绝不把图例文本或一个 `<canvas>`
 *    元素当成 Canvas 像素内容或原生渲染证据；
 *  - 本文件末尾的 dSF 子门额外读取真实 Web CanvasKit canvas screenshot 的有限像素信号，
 *    并验证同一 renderable program 的实际 hit；它不是 native 验证、GPU 性能结论、绝对视觉
 *    等价、无抗锯齿误差保证，也不是完整裁剪正确性的证明；
 *  - 不涉及原生平台行为。
 *
 * 断言依据 `SkiaFixtureSurface.tsx` 暴露的稳定 testID（react-native-web 映射为
 * data-testid）与确定性状态文本，见 `SKIA_FIXTURE_TEST_IDS` 与 `statusText` 格式。
 */

/** 稳定 testID 常量，避免测试里散落硬编码字符串（与 SKIA_FIXTURE_TEST_IDS 对齐） */
const TEST_ID = {
  root: 'skia-fixture-root',
  canvas: 'skia-fixture-canvas',
  resources: 'skia-fixture-resources',
  status: 'skia-fixture-status',
  frameOrigin: 'skia-fixture-frame-origin',
  frameDiagnostics: 'skia-fixture-frame-diagnostics',
  clipSceneNote: 'skia-fixture-clip-scene-note',
  scaleFour: 'skia-fixture-scale-four',
  scaleQuarter: 'skia-fixture-scale-quarter',
  scaleOne: 'skia-fixture-scale-one',
  scaleEight: 'skia-fixture-scale-eight',
  pan: 'skia-fixture-pan',
  panRight: 'skia-fixture-pan-右',
  panDown: 'skia-fixture-pan-下',
  panReset: 'skia-fixture-pan-reset',
  jumpFar: 'skia-fixture-jump-far',
  jumpGigaPos: 'skia-fixture-jump-giga-pos',
  geometryJump: 'skia-fixture-geometry-jump',
  frameVisible: 'skia-fixture-frame-visible',
  frameFragments: 'skia-fixture-frame-fragments',
  frameStatus: 'skia-fixture-frame-status',
  frameUnresolved: 'skia-fixture-frame-unresolved',
  frameClipping: 'skia-fixture-frame-clipping',
  geometryCapability: 'skia-fixture-geometry-capability',
  geometryDiagnostics: 'skia-fixture-geometry-diagnostics',
  geometryHitProbe: 'skia-fixture-geometry-hit-probe',
  geometryProbePartialCubic: 'skia-fixture-geometry-probe-partial-cubic',
  geometryProbePartialEllipse: 'skia-fixture-geometry-probe-partial-ellipse',
  geometryProbeCompoundInside: 'skia-fixture-geometry-probe-compound-inside',
  geometryProbeCompoundOutside: 'skia-fixture-geometry-probe-compound-outside',
  geometryProbeClipEdgeOutside: 'skia-fixture-geometry-probe-clip-edge-outside',
  textShapingStatus: 'skia-fixture-text-shaping-status',
  textShapingRuns: 'skia-fixture-text-shaping-runs',
  textShapingProbeVisible: 'skia-fixture-text-shaping-probe-visible',
  textShapingProbeOutside: 'skia-fixture-text-shaping-probe-outside',
  textLayoutBudget: 'skia-fixture-text-layout-budget',
  textShapingOverBudget: 'skia-fixture-text-shaping-over-budget-width',
} as const;

/**
 * 原始 paragraph 宽度与受预算约束的实际 layout 输入（DIP）。fixture 声明超宽文本原始宽
 * 4,000,000 DIP，core 将其 paragraphLayoutWidth 限额为 1,000,000 DIP；测试用这两个精确
 * 文本标记证明真实请求里同时保留了原始宽与受限输入，而不是把 4m 宽直接送进 CanvasKit。
 * 场景本身声明为 `fixture-text-shaping-over-budget-width`，其对外的 DOM 图例 testID 为
 * `skia-fixture-text-shaping-over-budget-width`（见 TEST_ID.textShapingOverBudget）。
 */
const OVER_BUDGET_ORIGINAL_WIDTH_MARKER = 'original=4000000 DIP';
const OVER_BUDGET_LAYOUT_INPUT_MARKER = 'layoutInput=1000000 DIP';

/** 8 个对象工具图例的 testID 后缀（= FIXTURE_OBJECT_LEGEND 的 tool 顺序） */
const OBJECT_TOOLS = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'text',
  'image',
] as const;

/**
 * 阶段 6.3 几何场景图例的 testID 后缀（= FIXTURE_SPATIAL_ENTRY_LEGEND 的 geometryTestId 顺序）。
 * 仅用于断言 DOM 语义存在，**不**作为 canvas 像素 / nonzero 拓扑 / native 渲染证据。
 */
const GEOMETRY_LEGEND_IDS = [
  'partial-cubic',
  'partial-ellipse',
  'partial-concave',
  'self-intersect',
  'contour-cap',
] as const;

/**
 * frame `program 状态汇总` 的稳定片段格式：`<status> eN/fN/sN/gN` 由多个以 ' · ' 连接。
 * 只校验「含 program 汇总」这一语义，不假定具体状态键或数值，避免把某一帧的偶然分布写死。
 */
const PROGRAM_SUMMARY_PATTERN = /\be\d+\/f\d+\/s\d+\/g\d+\b/;

/** overlay 角色图例：role 后缀 → 期望的 space 语义标记 */
const OVERLAY_ROLES: ReadonlyArray<readonly [string, 'world' | 'screen']> = [
  ['selection-box', 'world'],
  ['selection-handle', 'world'],
  ['lasso-preview', 'world'],
  ['cursor', 'screen'],
  ['eraser', 'screen'],
  ['zoom-feedback', 'screen'],
  ['angle-feedback', 'screen'],
  ['ruler', 'screen'],
];

/**
 * 仅过滤明确与产品逻辑无关的环境噪声（devtools 提示 / favicon / HMR 连接等）。
 * 不做过宽白名单，以免掩盖真正的产品 console error。
 */
const NON_PRODUCT_NOISE = [
  /favicon/i,
  /Download the React DevTools/i,
  /WebSocket connection/i,
];

function isProductError(message: string): boolean {
  return !NON_PRODUCT_NOISE.some((pattern) => pattern.test(message));
}

/** 记录 console error / pageerror，供正常路径末尾断言无产品级错误 */
function recordProductErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && isProductError(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (isProductError(error.message)) {
      pageErrors.push(error.message);
    }
  });
  return { consoleErrors, pageErrors };
}

/**
 * 进入隔离入口并等待真实 CanvasKit 从本地 WASM 加载、检验台 surface 挂载完成。
 * 返回本次加载的 `/canvaskit.wasm` 响应，供同源 / content-type 断言。
 */
async function openFixture(page: Page): Promise<Awaited<ReturnType<Page['waitForResponse']>>> {
  // 在导航前登记 WASM 响应等待：路由挂载即触发本地加载。
  const wasmResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
    { timeout: 90_000 }
  );

  await page.goto('/skia-drawing-fixture');

  // root 存在即代表 surface 结构已渲染
  await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
  // resources 文本出现在 <canvas> 之后、canvas 挂载之前，先等资源就绪
  await expect(page.getByTestId(TEST_ID.resources)).toContainText('资源就绪', { timeout: 90_000 });
  // canvas 挂载：真实 CanvasKit 已在浏览器内解码字体/图片并完成构帧
  await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible({ timeout: 90_000 });
  // 不应停留在 loading / error（该路由的失败态 testID）
  await expect(page.getByTestId('skia-fixture-loading')).toHaveCount(0);
  await expect(page.getByTestId('skia-fixture-error')).toHaveCount(0);

  return wasmResponse;
}

interface RgbaPng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface CanvasScreenshotReadback extends RgbaPng {
  cssWidth: number;
  cssHeight: number;
  cssX: number;
  cssY: number;
  pixelsPerCssX: number;
  pixelsPerCssY: number;
  pixelAreaPerCssPixel: number;
}

interface CssPoint {
  x: number;
  y: number;
}

/**
 * geometry-program 跳转的公开稳定世界中心与三个公开 probe 坐标。此子门固定先跳转、再设
 * scale=1，因此 `world - jumpCenter + canvasCenter` 就是可解释的 canvas CSS 局部投影。
 */
const GEOMETRY_JUMP_WORLD_CENTER = { x: 5_000_000, y: 5_000_000 } as const;
const COMPOUND_INSIDE_WORLD_POINT = { x: 5_000_080, y: 5_000_060 } as const;
const COMPOUND_OUTSIDE_WORLD_POINT = { x: 5_000_260, y: 4_999_980 } as const;
const CLIP_EDGE_OUTSIDE_WORLD_Y = 5_000_060;
const CLIP_EDGE_OUTSIDE_DISTANCE_CSS = 24;

const FILL_COLOR = rgb('#E7F5FF');
const SELF_INTERSECT_STROKE_COLOR = rgb('#1971C2');
const LOCAL_COLOR_TOLERANCE = 16;
const LOCAL_OPAQUE_ALPHA = 224;
const LOCAL_SAMPLE_RADIUS_CSS = 6;
const TEXT_SHAPING_COLOR_TOLERANCE = 64;
const TEXT_SHAPING_MINIMUM_CLUSTER_CSS_PIXELS = 10;
const TEXT_SHAPING_EMOJI_MINIMUM_CLUSTER_CSS_PIXELS = 6;

/** PNG scanline 的 Paeth 预测器；仅用于 Playwright screenshot 的标准 RGBA PNG readback。 */
function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

/**
 * 使用 Node 标准库解码 Playwright 内存 screenshot。
 * Playwright Chromium locator screenshot 可为 8-bit、非隔行 RGB 或 RGBA PNG；其他格式必须
 * 显式失败，避免把不能 readback 的 canvas 静默当作已验证。
 */
function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function decodeRgbaPng(png: Uint8Array): Promise<RgbaPng> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hasPngSignature = signature.every((byte, index) => png[index] === byte);
  if (png.length < signature.length || !hasPngSignature) {
    throw new Error('Canvas screenshot readback 失败：locator.screenshot() 未返回 PNG 数据。');
  }

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const imageData: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = readUint32BigEndian(png, offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) {
      throw new Error('Canvas screenshot readback 失败：PNG chunk 长度损坏。');
    }
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length !== 13) {
        throw new Error('Canvas screenshot readback 失败：PNG IHDR 长度无效。');
      }
      width = readUint32BigEndian(data, 0);
      height = readUint32BigEndian(data, 4);
      // 8-bit RGB/RGBA、deflate、标准 filter、非隔行是 locator screenshot 的确定性输出契约。
      colorType = data[9];
      if (
        data[8] !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        colorType = -1;
      }
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (colorType === -1 || width === 0 || height === 0 || imageData.length === 0) {
    throw new Error(
      'Canvas screenshot readback 失败：需要 8-bit、非隔行 RGB/RGBA PNG，或截图中没有可解码的像素数据。'
    );
  }

  let inflated: Uint8Array;
  try {
    // 依赖名由变量提供，令本仓库在未配置 @types/node 时仍可用运行时的 Node 标准 zlib。
    const zlibModuleName = 'node:zlib';
    const zlib = (await import(zlibModuleName)) as {
      inflateSync(compressed: Uint8Array): Uint8Array;
    };
    inflated = zlib.inflateSync(concatBytes(imageData));
  } catch (error) {
    throw new Error(
      `Canvas screenshot readback 失败：PNG IDAT 无法解压：${error instanceof Error ? error.message : String(error)}`
    );
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  if (inflated.length !== height * (stride + 1)) {
    throw new Error('Canvas screenshot readback 失败：PNG scanline 尺寸与 IHDR 不一致。');
  }

  const decoded = new Uint8Array(width * height * bytesPerPixel);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (stride + 1)];
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const source = inflated[sourceStart + column];
      const left = column >= bytesPerPixel ? decoded[targetStart + column - bytesPerPixel] : 0;
      const up = row > 0 ? decoded[targetStart - stride + column] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? decoded[targetStart - stride + column - bytesPerPixel]
          : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = source;
          break;
        case 1:
          value = (source + left) & 0xff;
          break;
        case 2:
          value = (source + up) & 0xff;
          break;
        case 3:
          value = (source + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (source + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Canvas screenshot readback 失败：不支持 PNG filter type ${filter}。`);
      }
      decoded[targetStart + column] = value;
    }
  }
  if (colorType === 6) {
    return { width, height, pixels: decoded };
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const rgbOffset = index * 3;
    const rgbaOffset = index * 4;
    pixels[rgbaOffset] = decoded[rgbOffset];
    pixels[rgbaOffset + 1] = decoded[rgbOffset + 1];
    pixels[rgbaOffset + 2] = decoded[rgbOffset + 2];
    pixels[rgbaOffset + 3] = 0xff;
  }
  return { width, height, pixels };
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** 将 fixture 声明的 #RRGGBB 颜色转换为 RGB，避免像素断言散落魔法数字。 */
function rgb(hex: string): RgbColor {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * 统计目标色附近最大的 8 邻接像素簇。阈值容纳 WebGL/canvas 抗锯齿和 screenshot 色彩舍入，
 * 但仍要求存在连续的非背景信号，而不是单个偶然色点。
 */
function largestNearbyColorCluster(
  image: RgbaPng,
  target: RgbColor,
  channelTolerance = 48,
  minimumAlpha = 1
): number {
  const pixelCount = image.width * image.height;
  const matching = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (
      image.pixels[offset + 3] >= minimumAlpha &&
      Math.abs(image.pixels[offset] - target.red) <= channelTolerance &&
      Math.abs(image.pixels[offset + 1] - target.green) <= channelTolerance &&
      Math.abs(image.pixels[offset + 2] - target.blue) <= channelTolerance
    ) {
      matching[index] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largestCluster = 0;
  for (let start = 0; start < pixelCount; start += 1) {
    if (matching[start] === 0 || visited[start] === 1) {
      continue;
    }
    let size = 0;
    let read = 0;
    let write = 0;
    queue[write] = start;
    write += 1;
    visited[start] = 1;
    while (read < write) {
      const current = queue[read];
      read += 1;
      size += 1;
      const row = Math.floor(current / image.width);
      const column = current % image.width;
      for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
        for (let columnDelta = -1; columnDelta <= 1; columnDelta += 1) {
          if (rowDelta === 0 && columnDelta === 0) {
            continue;
          }
          const nextRow = row + rowDelta;
          const nextColumn = column + columnDelta;
          if (
            nextRow < 0 ||
            nextRow >= image.height ||
            nextColumn < 0 ||
            nextColumn >= image.width
          ) {
            continue;
          }
          const next = nextRow * image.width + nextColumn;
          if (matching[next] === 1 && visited[next] === 0) {
            visited[next] = 1;
            queue[write] = next;
            write += 1;
          }
        }
      }
    }
    largestCluster = Math.max(largestCluster, size);
  }
  return largestCluster;
}

/**
 * 读取实际 CanvasKit canvas 的 locator screenshot，并以 canvas CSS box 归一化截图尺寸与簇阈值。
 * 这是跨 dSF 的有限 readback 信号：不作逐像素相等、完整裁剪或绝对视觉等价声明。
 */
async function readCanvasScreenshot(
  canvas: Locator,
  deviceScaleFactor: number
): Promise<CanvasScreenshotReadback> {
  let screenshot: Uint8Array;
  try {
    screenshot = await canvas.screenshot({ animations: 'disabled' });
  } catch (error) {
    throw new Error(
      `dSF=${deviceScaleFactor} Canvas screenshot readback 失败：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const image = await decodeRgbaPng(screenshot);
  const cssBox = await canvas.boundingBox();
  if (!cssBox || cssBox.width <= 0 || cssBox.height <= 0) {
    throw new Error(
      `dSF=${deviceScaleFactor} Canvas screenshot readback 失败：canvas CSS box 不可用。`
    );
  }
  const pixelsPerCssX = image.width / cssBox.width;
  const pixelsPerCssY = image.height / cssBox.height;
  expect(Math.abs(pixelsPerCssX - deviceScaleFactor)).toBeLessThan(0.02);
  expect(Math.abs(pixelsPerCssY - deviceScaleFactor)).toBeLessThan(0.02);
  return {
    ...image,
    cssWidth: cssBox.width,
    cssHeight: cssBox.height,
    cssX: cssBox.x,
    cssY: cssBox.y,
    pixelsPerCssX,
    pixelsPerCssY,
    pixelAreaPerCssPixel: pixelsPerCssX * pixelsPerCssY,
  };
}

/** 仅截取目标 CSS 点的小邻域；坐标或截图缩放不可靠时明确失败，而不是跳过像素验证。 */
function readCanvasCssNeighborhood(
  screenshot: CanvasScreenshotReadback,
  point: CssPoint,
  radiusCss: number,
  label: string
): RgbaPng {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || radiusCss <= 0) {
    throw new Error(`Canvas 局部 readback 失败：${label} 的 CSS 采样坐标无效。`);
  }
  const left = Math.floor((point.x - radiusCss) * screenshot.pixelsPerCssX);
  const top = Math.floor((point.y - radiusCss) * screenshot.pixelsPerCssY);
  const right = Math.ceil((point.x + radiusCss) * screenshot.pixelsPerCssX);
  const bottom = Math.ceil((point.y + radiusCss) * screenshot.pixelsPerCssY);
  if (
    left < 0 ||
    top < 0 ||
    right > screenshot.width ||
    bottom > screenshot.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error(
      `Canvas 局部 readback 失败：${label} 的 CSS 采样点 (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) 超出 canvas ${screenshot.cssWidth.toFixed(1)}×${screenshot.cssHeight.toFixed(1)}。`
    );
  }

  const width = right - left;
  const height = bottom - top;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * screenshot.width + left) * 4;
    pixels.set(screenshot.pixels.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}

/**
 * 依 canvas CSS box 将固定 text-shaping 布局区域裁为局部 PNG，避免把 DOM 图例或画布其他
 * 场景的像素混入断言。截图坐标始终按当前 dSF 归一化，不进行跨 dSF 逐像素比较。
 */
function readCanvasCssRegion(
  screenshot: CanvasScreenshotReadback,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
  label: string
): RgbaPng {
  if (
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    region.width <= 0 ||
    region.height <= 0
  ) {
    throw new Error(`Canvas 局部 readback 失败：${label} 的 CSS 区域无效。`);
  }
  const left = Math.floor(region.x * screenshot.pixelsPerCssX);
  const top = Math.floor(region.y * screenshot.pixelsPerCssY);
  const right = Math.ceil((region.x + region.width) * screenshot.pixelsPerCssX);
  const bottom = Math.ceil((region.y + region.height) * screenshot.pixelsPerCssY);
  if (
    left < 0 ||
    top < 0 ||
    right > screenshot.width ||
    bottom > screenshot.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error(
      `Canvas 局部 readback 失败：${label} 的 CSS 区域 (${region.x}, ${region.y}, ${region.width}, ${region.height}) 超出 canvas ${screenshot.cssWidth.toFixed(1)}×${screenshot.cssHeight.toFixed(1)}。`
    );
  }

  const width = right - left;
  const height = bottom - top;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * screenshot.width + left) * 4;
    pixels.set(screenshot.pixels.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}

/**
 * emoji fallback 可能是单色轮廓或彩色 glyph。先把有色或深色像素归一为黑色，再复用既有
 * 色簇 helper 统计连续簇；不假定 emoji 的具体字体、颜色或图案。
 */
function largestDarkOrColoredCluster(image: RgbaPng): number {
  const normalized = new Uint8Array(image.pixels.length);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const darkest = Math.min(red, green, blue);
    const lightest = Math.max(red, green, blue);
    const isDarkOrColored =
      image.pixels[offset + 3] >= LOCAL_OPAQUE_ALPHA &&
      (lightest <= 128 || lightest - darkest >= 48);
    normalized[offset] = isDarkOrColored ? 0 : 255;
    normalized[offset + 1] = isDarkOrColored ? 0 : 255;
    normalized[offset + 2] = isDarkOrColored ? 0 : 255;
    normalized[offset + 3] = 255;
  }
  return largestNearbyColorCluster(
    { width: image.width, height: image.height, pixels: normalized },
    rgb('#000000'),
    0,
    255
  );
}

/** geometry-program 跳转后的稳定 world 点投影到 canvas 本地 CSS DIP。 */
function projectGeometryWorldPointToCanvasCss(
  screenshot: CanvasScreenshotReadback,
  worldPoint: CssPoint
): CssPoint {
  return {
    x: screenshot.cssWidth / 2 + worldPoint.x - GEOMETRY_JUMP_WORLD_CENTER.x,
    y: screenshot.cssHeight / 2 + worldPoint.y - GEOMETRY_JUMP_WORLD_CENTER.y,
  };
}

/**
 * 读取 clip-edge-outside 实际 screen probe 周围的小 PNG 区域。它以 canvas CSS box 的右边缘
 * 加 24 DIP 定位，故不是 DOM 图例或 hit 文本；只观察该位置邻域，不做全页像素扫描。
 */
async function readClipEdgeOutsideScreenshot(
  page: Page,
  screenshot: CanvasScreenshotReadback,
  deviceScaleFactor: number,
  canvasLocalY: number
): Promise<RgbaPng> {
  const scroll = (await page.evaluate('({ x: window.scrollX, y: window.scrollY })')) as {
    x: number;
    y: number;
  };
  const radius = LOCAL_SAMPLE_RADIUS_CSS;
  const clip = {
    x: screenshot.cssX + scroll.x + screenshot.cssWidth + CLIP_EDGE_OUTSIDE_DISTANCE_CSS - radius,
    y: screenshot.cssY + scroll.y + canvasLocalY - radius,
    width: radius * 2,
    height: radius * 2,
  };
  let png: Uint8Array;
  try {
    png = await page.screenshot({ clip, animations: 'disabled' });
  } catch (error) {
    throw new Error(
      `dSF=${deviceScaleFactor} clip-edge-outside 局部 PNG readback 失败：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const image = await decodeRgbaPng(png);
  expect(image.width / clip.width).toBeCloseTo(deviceScaleFactor, 2);
  expect(image.height / clip.height).toBeCloseTo(deviceScaleFactor, 2);
  return image;
}

async function expectActualGeometryProbe(
  page: Page,
  buttonId: string,
  expectedActualResult: string,
  expectedStatus?: string
): Promise<void> {
  await page.getByTestId(buttonId).click();
  const result = page.getByTestId(TEST_ID.geometryHitProbe);
  await expect(result).toContainText(expectedActualResult);
  if (expectedStatus) {
    await expect(result).toContainText(expectedStatus);
  }
}

/** 对一个独立 dSF context 采集真实 CanvasKit 加载、同 program hit 与 screenshot 像素信号。 */
async function verifyWebCanvasKitGeometryAtDeviceScaleFactor(
  browser: Browser,
  deviceScaleFactor: number
): Promise<void> {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5266',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    const wasmResponse = await openFixture(page);

    expect(new URL(wasmResponse.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(wasmResponse.url()).pathname).toBe('/canvaskit.wasm');
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()['content-type'] ?? '').toContain('application/wasm');
    await expect(page.getByTestId(TEST_ID.root)).toBeVisible();
    const resources = page.getByTestId(TEST_ID.resources);
    await expect(resources).toBeVisible();
    await expect(resources).toContainText('资源就绪');
    const canvas = page.getByTestId(TEST_ID.canvas);
    await expect(canvas).toBeVisible();

    await page.getByTestId(TEST_ID.geometryJump).click();
    await page.getByTestId(TEST_ID.scaleOne).click();
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).toHaveText('无');
    await expect(page.getByTestId(TEST_ID.frameUnresolved)).toHaveCount(0);

    // 每次点击均由 fixture 投影世界坐标后实际调用 hitTestDrawingFrame，不 mock、不拼接结果。
    await expectActualGeometryProbe(
      page,
      TEST_ID.geometryProbePartialCubic,
      '实际命中 id=fixture-geometry-partial-cubic',
      'status=clipped'
    );
    await expectActualGeometryProbe(
      page,
      TEST_ID.geometryProbePartialEllipse,
      '实际命中 id=fixture-geometry-partial-ellipse',
      'status=clipped'
    );
    await expectActualGeometryProbe(
      page,
      TEST_ID.geometryProbeCompoundInside,
      '实际命中 id=fixture-geometry-self-intersect'
    );
    await expectActualGeometryProbe(page, TEST_ID.geometryProbeCompoundOutside, '实际未命中');
    await expectActualGeometryProbe(page, TEST_ID.geometryProbeClipEdgeOutside, '实际未命中');

    const screenshot = await readCanvasScreenshot(canvas, deviceScaleFactor);
    // 下限来自画布实际 CSS box 对应的 screenshot 像素面积，而不是跨 dSF 逐像素比较。
    const minimumClusterPixels = 16 * screenshot.pixelAreaPerCssPixel;
    for (const [label, color] of [
      ['partial cubic #C2255C', rgb('#C2255C')],
      ['partial ellipse #7B1FA2', rgb('#7B1FA2')],
      ['self-intersect compound #1971C2', rgb('#1971C2')],
    ] as const) {
      const largestCluster = largestNearbyColorCluster(screenshot, color);
      expect(
        largestCluster,
        `dSF=${deviceScaleFactor} CanvasKit screenshot 未发现足量 ${label} 附近的连续非背景像素簇`
      ).toBeGreaterThanOrEqual(minimumClusterPixels);
    }

    // 这是同一 geometry-program frame 的有限局部 PNG readback：不把命中文本或 DOM 图例当像素。
    await expect(page.getByTestId(TEST_ID.frameStatus)).toContainText(PROGRAM_SUMMARY_PATTERN);
    const compoundInsideCss = projectGeometryWorldPointToCanvasCss(
      screenshot,
      COMPOUND_INSIDE_WORLD_POINT
    );
    const compoundOutsideCss = projectGeometryWorldPointToCanvasCss(
      screenshot,
      COMPOUND_OUTSIDE_WORLD_POINT
    );
    const compoundInside = readCanvasCssNeighborhood(
      screenshot,
      compoundInsideCss,
      LOCAL_SAMPLE_RADIUS_CSS,
      'compound inside'
    );
    const compoundOutside = readCanvasCssNeighborhood(
      screenshot,
      compoundOutsideCss,
      LOCAL_SAMPLE_RADIUS_CSS,
      'compound outside'
    );
    // dSF 仅改变 readback 像素密度；阈值保持为固定 CSS 面积，容纳边缘抗锯齿而不扫描全画布。
    const minimumLocalClusterPixels = 4 * screenshot.pixelAreaPerCssPixel;
    expect(
      largestNearbyColorCluster(
        compoundInside,
        FILL_COLOR,
        LOCAL_COLOR_TOLERANCE,
        LOCAL_OPAQUE_ALPHA
      ),
      `dSF=${deviceScaleFactor} compound inside CSS (${compoundInsideCss.x.toFixed(1)}, ${compoundInsideCss.y.toFixed(1)}) 未读到足量 #E7F5FF 不透明局部 fill 信号`
    ).toBeGreaterThanOrEqual(minimumLocalClusterPixels);
    expect(
      largestNearbyColorCluster(
        compoundOutside,
        FILL_COLOR,
        LOCAL_COLOR_TOLERANCE,
        LOCAL_OPAQUE_ALPHA
      ),
      `dSF=${deviceScaleFactor} compound outside CSS (${compoundOutsideCss.x.toFixed(1)}, ${compoundOutsideCss.y.toFixed(1)}) 出现足量 #E7F5FF 局部 fill 信号`
    ).toBeLessThan(minimumLocalClusterPixels);

    const clipEdgeOutsideCssY = projectGeometryWorldPointToCanvasCss(screenshot, {
      x: GEOMETRY_JUMP_WORLD_CENTER.x,
      y: CLIP_EDGE_OUTSIDE_WORLD_Y,
    }).y;
    const clipEdgeOutside = await readClipEdgeOutsideScreenshot(
      page,
      screenshot,
      deviceScaleFactor,
      clipEdgeOutsideCssY
    );
    expect(
      largestNearbyColorCluster(
        clipEdgeOutside,
        SELF_INTERSECT_STROKE_COLOR,
        LOCAL_COLOR_TOLERANCE,
        LOCAL_OPAQUE_ALPHA
      ),
      `dSF=${deviceScaleFactor} clip-edge-outside CSS (${(screenshot.cssWidth + CLIP_EDGE_OUTSIDE_DISTANCE_CSS).toFixed(1)}, ${clipEdgeOutsideCssY.toFixed(1)}) 出现足量 #1971C2 连续 stroke 信号`
    ).toBeLessThan(minimumLocalClusterPixels);

    // 不能吞产品错误：只沿用既有的窄环境噪声过滤。
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

/**
 * 对一个独立 dSF context 采集 text-shaping 场景真实 CanvasKit 状态、同 program hit 与局部
 * screenshot 色簇。仅观察本次 Web CanvasKit 的有限像素/readback 与同程序 hit 信号，不是
 * native 或 GPU 性能验证、绝对字形正确性结论，也不要求跨 dSF 逐像素等价。
 */
async function verifyWebCanvasKitTextShapingAtDeviceScaleFactor(
  browser: Browser,
  deviceScaleFactor: number
): Promise<void> {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5266',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    const wasmResponse = await openFixture(page);

    expect(new URL(wasmResponse.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(wasmResponse.url()).pathname).toBe('/canvaskit.wasm');
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()['content-type'] ?? '').toContain('application/wasm');

    await page.getByTestId('skia-fixture-jump-text-shaping').click();
    const shapingStatus = page.getByTestId(TEST_ID.textShapingStatus);
    // 必须确实完成五个完整 Paragraph 请求（既有 Latin/CJK/Arabic/emoji + 版本 16 新增超宽
    // 文本）；pending 或 unsupported 都不被当作可通过状态。
    // 说明：真实 provider 对长文本的 continuation 准备在无头 Chromium 中会明显超过
    // Playwright 默认的 5s 断言窗口（独立探针实测最长约 45s 内稳定 ready 5/5），因此这里
    // 对正向 ready 断言显式给足 45s 超时。这里的等待只是给“最终成功”更多时间，并不会把
    // pending / unsupported 视为通过：一旦 45s 内未达到 ready：5/5，下面的正向断言即失败，
    // 且紧随其后的 pending / unsupported 反向断言仍会独立失败。
    await expect(shapingStatus).toContainText('ready：5/5', { timeout: 45_000 });
    await expect(shapingStatus).not.toContainText('pending：');
    await expect(shapingStatus).not.toContainText('unsupported');
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).toHaveText('无');
    // 超宽文本若触发真实 unresolved，会在此元素如实显示；这里要求它完全不出现。
    await expect(page.getByTestId(TEST_ID.frameUnresolved)).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(1);

    // 版本 16 新增超宽文本：其稳定图例（与场景 ID 同名）必须可见存在。
    await expect(page.getByTestId(TEST_ID.textShapingOverBudget)).toBeVisible();

    // 与上面的 ready / 同 program 命中 / readback 同处一份测试读取预算文案：证明原始 4m 宽
    // 与受限 layout 输入同时保留在真实请求中，而不是把 4m 宽直接送进 CanvasKit。DOM 文案不
    // 单独作为渲染证据，它必须与 ready + 同帧命中 + screenshot readback 一起观察。
    const textLayoutBudget = page.getByTestId(TEST_ID.textLayoutBudget);
    await expect(textLayoutBudget).toBeVisible();
    await expect(textLayoutBudget).toContainText(OVER_BUDGET_ORIGINAL_WIDTH_MARKER);
    await expect(textLayoutBudget).toContainText(OVER_BUDGET_LAYOUT_INPUT_MARKER);

    const shapedRuns = page.getByTestId(TEST_ID.textShapingRuns);
    await expect(shapedRuns).toHaveText(/[1-9]\d*\s*\/\s*[1-9]\d*/);
    const runStatistics = (await shapedRuns.textContent())?.trim() ?? '';
    const runStatisticsMatch = runStatistics.match(/^(\d+)\s*\/\s*(\d+)$/);
    expect(
      runStatisticsMatch,
      `dSF=${deviceScaleFactor} shaped run / semantic region 统计格式无效`
    ).not.toBeNull();
    expect(Number(runStatisticsMatch?.[1])).toBeGreaterThan(0);
    expect(Number(runStatisticsMatch?.[2])).toBeGreaterThan(0);

    // 两个 probe 都从当前 frame 投影坐标后调用 hitTestDrawingFrame，非由 DOM 图例或像素推断。
    const hitProbe = page.getByTestId('skia-fixture-hit-probe');
    await page.getByTestId(TEST_ID.textShapingProbeVisible).click();
    await expect(hitProbe).toContainText(
      '命中 fixture-text-shaping-latin-combining，status=clipped'
    );
    await expect(hitProbe).toContainText('实际命中 id=fixture-text-shaping-latin-combining');
    await expect(hitProbe).toContainText('status=clipped');
    await page.getByTestId(TEST_ID.textShapingProbeOutside).click();
    await expect(hitProbe).toContainText('实际未命中');

    const canvas = page.getByTestId(TEST_ID.canvas);
    await expect(canvas).toBeVisible();
    const screenshot = await readCanvasScreenshot(canvas, deviceScaleFactor);
    const minimumClusterPixels =
      TEXT_SHAPING_MINIMUM_CLUSTER_CSS_PIXELS * screenshot.pixelAreaPerCssPixel;
    for (const [label, region, color] of [
      ['Latin 顶部深蓝行', { x: 0, y: 0, width: screenshot.cssWidth, height: 100 }, rgb('#1A237E')],
      ['CJK 洋红区域', { x: 40, y: 120, width: 190, height: 100 }, rgb('#C2255C')],
      ['Arabic 青绿区域', { x: 80, y: 250, width: 190, height: 100 }, rgb('#0B7285')],
    ] as const) {
      const localImage = readCanvasCssRegion(screenshot, region, label);
      expect(
        largestNearbyColorCluster(
          localImage,
          color,
          TEXT_SHAPING_COLOR_TOLERANCE,
          LOCAL_OPAQUE_ALPHA
        ),
        `dSF=${deviceScaleFactor} ${label} 未读到足量连续目标色簇`
      ).toBeGreaterThanOrEqual(minimumClusterPixels);
    }

    // emoji 允许 monochrome / 彩色 fallback；只要求右下局部 tile 内存在连续的非背景 glyph 信号。
    const emojiImage = readCanvasCssRegion(
      screenshot,
      { x: 360, y: 330, width: 130, height: 90 },
      'emoji 右下区域'
    );
    expect(
      largestDarkOrColoredCluster(emojiImage),
      `dSF=${deviceScaleFactor} emoji 右下区域未读到足量连续深色或有色非背景簇`
    ).toBeGreaterThanOrEqual(
      TEXT_SHAPING_EMOJI_MINIMUM_CLUSTER_CSS_PIXELS * screenshot.pixelAreaPerCssPixel
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe('/skia-drawing-fixture Web 持久 E2E', () => {
  test('本地 CanvasKit 同源加载、DOM 结构与图例语义、无产品错误', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    const wasmResponse = await openFixture(page);
    const response = await wasmResponse;

    // 同源：WASM 来源与页面同 origin；路径为本地的 /canvaskit.wasm
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(response.url()).pathname).toBe('/canvaskit.wasm');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] ?? '').toContain('application/wasm');

    // root / resources / canvas 存在
    await expect(page.getByTestId(TEST_ID.root)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.resources)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible();

    // 全页仅一个 <canvas>：这是 DOM 元素计数，不代表像素内容或原生渲染证据
    await expect(page.locator('canvas')).toHaveCount(1);

    // 8 个对象图例：仅声明 DOM 语义存在（不是 canvas 像素）
    await expect(page.locator('[data-testid^="skia-fixture-object-"]')).toHaveCount(
      OBJECT_TOOLS.length
    );
    for (const tool of OBJECT_TOOLS) {
      await expect(page.getByTestId(`skia-fixture-object-${tool}`)).toBeVisible();
    }

    // world / screen overlay 角色图例存在，且各自带正确的 space 语义标记
    await expect(page.getByTestId('skia-fixture-overlays')).toBeVisible();
    for (const [role, space] of OVERLAY_ROLES) {
      await expect(page.getByTestId(`skia-fixture-overlay-role-${role}`)).toContainText(
        `[${space}]`
      );
    }

    // 可视状态：pan 控制组与帧诊断面板存在（稳定的 DOM 存在性，不解读脆弱内容）
    await expect(page.getByTestId(TEST_ID.pan)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).not.toHaveText('');
    // 裁剪场景说明为稳定 DOM 文本存在性，不校验具体措辞
    await expect(page.getByTestId(TEST_ID.clipSceneNote)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.clipSceneNote)).not.toHaveText('');

    // 正常流程不应产生产品级 console error / pageerror
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('缩放至 4 / 右移 / 下移 / 回中的状态文本，跳转远端与 1e9 后 frame origin 改变', async ({
    page,
  }) => {
    await openFixture(page);

    const status = page.getByTestId(TEST_ID.status);
    const origin = page.getByTestId(TEST_ID.frameOrigin);

    // 初始受控视口：scale 1.00 · tx 0 · ty 0（DIP）
    await expect(status).toHaveText('scale 1.00 · tx 0 · ty 0（DIP）');

    // 缩放至 4 倍
    await page.getByTestId(TEST_ID.scaleFour).click();
    await expect(status).toHaveText('scale 4.00 · tx 0 · ty 0（DIP）');

    // 向右平移 1 步（+80 DIP）
    await page.getByTestId(TEST_ID.panRight).click();
    await expect(status).toHaveText('scale 4.00 · tx 80 · ty 0（DIP）');

    // 向下平移 1 步（+80 DIP）
    await page.getByTestId(TEST_ID.panDown).click();
    await expect(status).toHaveText('scale 4.00 · tx 80 · ty 80（DIP）');

    // 回中：tx/ty 归零，scale 保持 4
    await page.getByTestId(TEST_ID.panReset).click();
    await expect(status).toHaveText('scale 4.00 · tx 0 · ty 0（DIP）');

    // frame origin 断言：先记录当前 origin，再比较跳转后是否改变
    const initialOrigin = (await origin.textContent())?.trim() ?? '';
    expect(initialOrigin).not.toBe('');

    // 跳转「远端 50k」：frame origin（world DIP）应改变
    await page.getByTestId(TEST_ID.jumpFar).click();
    await expect(origin).not.toHaveText(initialOrigin, { timeout: 30_000 });
    const farOrigin = (await origin.textContent())?.trim() ?? '';

    // 跳转「1e9+0.125」：origin 再次改变（重基点随行）
    await page.getByTestId(TEST_ID.jumpGigaPos).click();
    await expect(origin).not.toHaveText(farOrigin, { timeout: 30_000 });
  });

  /**
   * 阶段 6.3 几何 program 场景的有界 Web E2E。
   *
   * 断言范围（严格限定为 DOM / 路由语义）：
   *  - 跳转「几何 program」后 5 个几何图例、capability/diagnostics 说明可见；
   *  - frame diagnostics 面板非空，frame status 含 program 汇总（e/f/s/g），视口状态随缩放更新；
   *  - 若真实 unresolved 出现，其文案明确「不渲染、不参与命中」；
   *    若安全 clipping 出现，其文案明确「已安全完成 / renderable program」；
   *  - 全程不产生产品级 console error / pageerror。
   *
   * 证据边界（与文件头声明一致）：
   *  - 图例文本、canvas 数量、hit probe 文本一律**不**当作 canvas 像素、nonzero 拓扑、
   *    原生渲染、性能或无视觉误差的证据；真实像素需由父级截图流程另行验证；
   *  - 不假定所有条目必然无 diagnostic；unresolved / clipping 文案做条件式弹性断言。
   */
  test('几何 program 场景：图例/诊断语义、program 汇总随缩放更新、安全裁剪诚实文案、无产品错误', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    await openFixture(page);

    const viewportStatus = page.getByTestId(TEST_ID.status);
    const frameStatus = page.getByTestId(TEST_ID.frameStatus);
    const origin = page.getByTestId(TEST_ID.frameOrigin);
    const frameError = page.getByTestId('skia-fixture-frame-error');

    // 跳转「几何 program」场景（远端大坐标）：先记录 origin，再等其改变确认构帧完成。
    const initialOrigin = (await origin.textContent())?.trim() ?? '';
    expect(initialOrigin).not.toBe('');
    await page.getByTestId(TEST_ID.geometryJump).click();
    await expect(origin).not.toHaveText(initialOrigin, { timeout: 30_000 });

    // 5 个几何图例存在：仅为 DOM 语义存在性，不代表像素或 nonzero 拓扑已被验证。
    for (const id of GEOMETRY_LEGEND_IDS) {
      await expect(page.getByTestId(`skia-fixture-geometry-${id}`)).toBeVisible();
    }

    // capability / diagnostics / hit probe 说明存在：capability 文案如实声明「不承诺无视觉误差」。
    await expect(page.getByTestId(TEST_ID.geometryCapability)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.geometryCapability)).toContainText('不承诺无视觉误差');
    await expect(page.getByTestId(TEST_ID.geometryDiagnostics)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.geometryHitProbe)).toBeVisible();

    // frame diagnostics 面板非空（内容可能是「无」或具体诊断，按真实可观察状态弹性处理）。
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.frameDiagnostics)).not.toHaveText('');

    // visible / fragments 读数非空；frame status 含 program 汇总（e/f/s/g）与 unresolved 计数语义。
    await expect(page.getByTestId(TEST_ID.frameVisible)).not.toHaveText('');
    await expect(page.getByTestId(TEST_ID.frameFragments)).not.toHaveText('');
    await expect(frameStatus).toContainText(PROGRAM_SUMMARY_PATTERN);

    // 条件式诚实文案：unresolved 必须明确「不渲染、不参与命中」；安全 clipping 必须明确「已安全完成」。
    const unresolved = page.getByTestId(TEST_ID.frameUnresolved);
    if ((await unresolved.count()) > 0) {
      await expect(unresolved).toContainText('不渲染');
      await expect(unresolved).toContainText('不参与命中');
    }
    const clipping = page.getByTestId(TEST_ID.frameClipping);
    if ((await clipping.count()) > 0) {
      await expect(clipping).toContainText('已安全完成');
      await expect(clipping).toContainText('renderable program');
    }

    // 依次切换 0.25× / 1× / 8×：视口状态可更新、frame status 非空且不出现 frame error。
    // 注意：jumpTo 以「跳转时」的 scale 居中目标并固定 tx/ty；之后仅改 scale 会让几何场景
    // 移出画布，visibleEntries 可能合法为空（frame status 显示 " / 0"）。因此这里只做
    // 真实可观察状态的弹性断言：不假定每个档位都有 program 汇总、也不假定无 diagnostic。
    for (const [scaleId, expectedText] of [
      [TEST_ID.scaleQuarter, 'scale 0.25'],
      [TEST_ID.scaleOne, 'scale 1.00'],
      [TEST_ID.scaleEight, 'scale 8.00'],
    ] as const) {
      await page.getByTestId(scaleId).click();
      await expect(viewportStatus).toContainText(expectedText);
      await expect(frameStatus).not.toHaveText('-');
      await expect(frameStatus).not.toHaveText('');
      await expect(frameError).toHaveCount(0);
    }

    // 全程不应产生产品级 console error / pageerror。
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  /**
   * P0-1：真实 Web CanvasKit dSF 像素/readback 与同 program hit 子门。
   *
   * 只证明本次 Chromium screenshot/readback 中有限的颜色簇信号，以及按钮调用的同一
   * renderable geometry program hit 返回。它不是 native 验证、GPU 性能测试、绝对视觉等价、
   * 无抗锯齿误差声明或完整裁剪证明。每个 dSF 使用独立 context，避免浏览器缩放状态泄漏。
   */
  test('P0-1：dSF=1/2 的真实 CanvasKit screenshot 像素簇与同 program hit', async () => {
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    });
    try {
      for (const deviceScaleFactor of [1, 2]) {
        await verifyWebCanvasKitGeometryAtDeviceScaleFactor(browser, deviceScaleFactor);
      }
    } finally {
      await browser.close();
    }
  });

  /**
   * P0-2：Web CanvasKit text-shaping 的有界 dSF 子门。
   *
   * 仅证明本次 Web CanvasKit 的有限 screenshot/readback、以及同一 renderable text program
   * 的实际 hit 信号；不是 native 验证、GPU 性能或绝对字形正确性结论，也不要求跨 dSF 逐像素
   * 等价。
   */
  test('P0-2：dSF=1/2 的真实 CanvasKit text-shaping 状态、局部像素簇与同 program hit', async () => {
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    });
    try {
      for (const deviceScaleFactor of [1, 2]) {
        await verifyWebCanvasKitTextShapingAtDeviceScaleFactor(browser, deviceScaleFactor);
      }
    } finally {
      await browser.close();
    }
  });
});
