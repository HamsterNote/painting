import { expect, type BrowserContext, type CDPSession, type Page, test } from '@playwright/test';

/**
 * `/skia-drawing-fixture` Web 性能信号「有界采集」持久 Playwright Chromium E2E（阶段 10 有界证据）。
 *
 * 本 spec 只做一件事：在同一浏览器 / 同一页面环境里，对「真实本地 CanvasKit 加载 + 真实
 * scale/pan 控件交互」之后的 Web 调度信号做有界采样，并读取 wasm 的 Resource Timing。
 * 它不是性能门禁，也不声明任何性能结论。
 *
 * 证据边界（务必按此理解，不得外推）：
 *  - requestAnimationFrame 间隔只是「同环境 Web 调度信号」：反映浏览器合成器在本次
 *    headless Chromium 进程与当前负载下回调的节奏，不是 GPU 帧时间、不是绘制/合成耗时、
 *    也不是性能 SLA；不同机器、不同 CI、不同负载之间不可比较。
 *  - 本 spec 不设 FPS、60Hz、毫秒绝对值、p50/p95 或任何性能阈值；只断言样本量足够、
 *    样本数值有限且为正、以及 Resource Timing 字段存在（或明确处理浏览器限制）。
 *  - DOM 可见 / <canvas> 存在不等同于 Canvas 像素内容，不等同于 native 或 GPU 渲染证据；
 *    本 spec 不做像素比对，也不涉及 iOS/Android 真实运行时。
 *  - 可选 CDP 4x CPU throttle 采样只是额外一次独立采样；若本环境不稳定则如实跳过，
 *    不强行断言、不修改任何配置；它同样不是性能门禁。
 *
 * 环境与依赖：
 *  - 固定 viewport 与 deviceScaleFactor=1（不随宿主 DPI 变化）；
 *  - 沿用既有 fixture E2E 的环境噪声过滤风格，正常流程不得产生产品级 console error / pageerror；
 *  - 遵循仓库既有 playwright.config.ts，不修改重试、超时或 webServer 配置。
 */

/** 固定视口与 dSF=1：让本次采集的「同环境」条件明确、可复现，不继承宿主缩放。 */
test.use({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});

/** 稳定 testID 常量（与 SKIA_FIXTURE_TEST_IDS / SkiaFixtureSurface.tsx 对齐） */
const TEST_ID = {
  root: 'skia-fixture-root',
  canvas: 'skia-fixture-canvas',
  resources: 'skia-fixture-resources',
  status: 'skia-fixture-status',
  scaleFour: 'skia-fixture-scale-four',
  panRight: 'skia-fixture-pan-右',
  panDown: 'skia-fixture-pan-下',
  panReset: 'skia-fixture-pan-reset',
} as const;

/** 至少采集的 rAF 间隔样本量（有界证据下限，不是性能阈值） */
const MIN_RAF_SAMPLES = 30;
/** warmup 帧数：丢弃首帧与布局抖动，不计入样本 */
const RAF_WARMUP_FRAMES = 12;

/**
 * 仅过滤明确与产品逻辑无关的环境噪声（devtools / favicon / HMR 等）。
 * 不做过宽白名单，以免掩盖真正的产品 console error（沿用既有 fixture E2E 风格）。
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
 * 页面内先 warmup 再采集 requestAnimationFrame 间隔（毫秒）。
 * 返回的是同环境 Web 调度信号，不是 GPU 帧时间，也不是绘制耗时；调用方只能断言样本量、
 * 有限性与正数，绝不能据此设定性能阈值。
 */
async function sampleRafIntervals(
  page: Page,
  warmupFrames: number,
  sampleCount: number
): Promise<number[]> {
  return page.evaluate(
    async ({ warmupFrames: warmup, sampleCount: samples }) => {
      const waitFrame = (): Promise<number> =>
        new Promise<number>((resolve) => {
          requestAnimationFrame((timestamp) => resolve(timestamp));
        });

      // warmup：丢弃前若干帧，避免把首帧 / 首次布局抖动计入样本
      let last = await waitFrame();
      for (let index = 0; index < warmup; index += 1) {
        last = await waitFrame();
      }

      const intervals: number[] = [];
      while (intervals.length < samples) {
        const now = await waitFrame();
        intervals.push(now - last);
        last = now;
      }
      return intervals;
    },
    { warmupFrames, sampleCount }
  );
}

/** Resource Timing 中我们关心的 wasm 字段（均为浏览器提供的数值，非产品测量） */
interface WasmResourceTiming {
  name: string;
  startTime: number;
  duration: number;
  responseStart: number;
  responseEnd: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

/**
 * 从 Resource Timing 读取同源 /canvaskit.wasm 资源条目。
 * 若存在多条（重试 / 预取），取 transferSize 最大的一条，避免歧义。
 */
async function readWasmResourceTiming(page: Page): Promise<WasmResourceTiming | null> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const wasmEntries = entries.filter((entry) => {
      try {
        return new URL(entry.name).pathname === '/canvaskit.wasm';
      } catch {
        return false;
      }
    });
    if (wasmEntries.length === 0) {
      return null;
    }
    const entry = wasmEntries.reduce((best, current) =>
      current.transferSize > best.transferSize ? current : best
    );
    return {
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      responseStart: entry.responseStart,
      responseEnd: entry.responseEnd,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    };
  });
}

/**
 * 进入隔离入口并等待真实 CanvasKit 从本地 WASM 加载、检验台 surface 挂载完成。
 * 返回本次加载的 /canvaskit.wasm 响应，供同源 / content-type 断言。
 */
async function openFixture(page: Page): Promise<Awaited<ReturnType<Page['waitForResponse']>>> {
  // 在导航前登记 WASM 响应等待：路由挂载即触发本地加载。
  const wasmResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
    { timeout: 90_000 }
  );

  await page.goto('/skia-drawing-fixture');

  // root / resources / canvas：真实 CanvasKit 已在浏览器内解码字体/图片并完成构帧
  await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId(TEST_ID.resources)).toContainText('资源就绪', { timeout: 90_000 });
  await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible({ timeout: 90_000 });
  // 不应停留在 loading / error
  await expect(page.getByTestId('skia-fixture-loading')).toHaveCount(0);
  await expect(page.getByTestId('skia-fixture-error')).toHaveCount(0);

  return wasmResponse;
}

/**
 * 可选：尝试开启 CDP 4x CPU throttle。仅当本环境能成功建立 CDP 会话并设置速率时返回 client；
 * 任何失败（非 Chromium、CDP 不可用、headless 差异等）都如实返回 null 并记录，不强行断言。
 */
async function tryApplyCpuThrottle(
  page: Page,
  context: BrowserContext
): Promise<CDPSession | null> {
  try {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    return client;
  } catch (error) {
    console.warn(
      `[skia-performance] 可选 CDP 4x CPU throttle 不可用，已跳过独立采样：${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/** 断言 rAF 样本：数量足够、每个间隔有限且为正（不设任何性能阈值） */
function expectBoundedRafSamples(intervals: number[]): void {
  expect(intervals.length).toBeGreaterThanOrEqual(MIN_RAF_SAMPLES);
  for (const interval of intervals) {
    expect(Number.isFinite(interval)).toBe(true);
    expect(interval).toBeGreaterThan(0);
  }
}

test.describe('/skia-drawing-fixture Web 性能信号有界采集', () => {
  test('本地 CanvasKit 加载、真实控件有限交互、rAF 调度信号与 wasm Resource Timing 有界证据', async ({
    page,
    context,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    // ===== 1) 本地 CanvasKit 同源加载：200 + application/wasm =====
    const response = await openFixture(page);
    const responseUrl = new URL(response.url());
    expect(responseUrl.origin).toBe(new URL(page.url()).origin);
    expect(responseUrl.pathname).toBe('/canvaskit.wasm');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] ?? '').toContain('application/wasm');

    // ===== 2) 对真实 scale / pan 控件做有限交互（只验证受控状态文本，不解读像素） =====
    const status = page.getByTestId(TEST_ID.status);
    await expect(status).toHaveText('scale 1.00 · tx 0 · ty 0（DIP）');

    await page.getByTestId(TEST_ID.scaleFour).click();
    await expect(status).toHaveText('scale 4.00 · tx 0 · ty 0（DIP）');

    await page.getByTestId(TEST_ID.panRight).click();
    await expect(status).toHaveText('scale 4.00 · tx 80 · ty 0（DIP）');

    await page.getByTestId(TEST_ID.panDown).click();
    await expect(status).toHaveText('scale 4.00 · tx 80 · ty 80（DIP）');

    await page.getByTestId(TEST_ID.panReset).click();
    await expect(status).toHaveText('scale 4.00 · tx 0 · ty 0（DIP）');

    // ===== 3) warmup 后采集 rAF 间隔（同环境 Web 调度信号，非 GPU 帧时间） =====
    const intervals = await sampleRafIntervals(page, RAF_WARMUP_FRAMES, MIN_RAF_SAMPLES);
    expectBoundedRafSamples(intervals);

    // ===== 4) Resource Timing 读取 wasm 资源信息（同源，字段应完整） =====
    const timing = await readWasmResourceTiming(page);
    expect(timing).not.toBeNull();
    if (timing) {
      // 时间字段必须存在且有限、非负；duration 为资源加载耗时（非性能门禁）
      for (const field of ['startTime', 'duration', 'responseStart', 'responseEnd'] as const) {
        expect(Number.isFinite(timing[field])).toBe(true);
        expect(timing[field]).toBeGreaterThanOrEqual(0);
      }
      // 响应结束不得早于响应开始（浏览器给出的时序自洽性，非性能阈值）
      expect(timing.responseEnd).toBeGreaterThanOrEqual(timing.responseStart);
      // 尺寸字段必须存在且为有限数（缓存 / TAO 限制下可能为 0，故先断言类型与有限性）
      for (const field of ['transferSize', 'encodedBodySize', 'decodedBodySize'] as const) {
        expect(typeof timing[field]).toBe('number');
        expect(Number.isFinite(timing[field])).toBe(true);
      }
      // 同源本地 wasm 至少要有一个非零尺寸信号（否则视为浏览器限制未给出字节信息）
      const sizeSignal = Math.max(
        timing.transferSize,
        timing.encodedBodySize,
        timing.decodedBodySize
      );
      expect(sizeSignal).toBeGreaterThan(0);
    }

    // 正常流程不应产生产品级 console error / pageerror
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ===== 5) 可选：CDP 4x CPU throttle 独立采样（best-effort，不稳定即跳过） =====
    const throttleClient = await tryApplyCpuThrottle(page, context);
    if (throttleClient) {
      let throttledIntervals: number[] | null = null;
      try {
        throttledIntervals = await sampleRafIntervals(page, 6, MIN_RAF_SAMPLES);
      } catch (error) {
        // 限速下采样不稳定：如实记录并跳过，不强行断言（且不改任何配置）
        console.warn(
          `[skia-performance] 可选 CDP 4x CPU 采样不稳定，已跳过：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        // 无论如何都恢复速率并断开 CDP 会话，避免影响后续测试
        await throttleClient
          .send('Emulation.setCPUThrottlingRate', { rate: 1 })
          .catch(() => undefined);
        await throttleClient.detach().catch(() => undefined);
      }
      if (throttledIntervals) {
        expectBoundedRafSamples(throttledIntervals);
      }
    }
  });
});
