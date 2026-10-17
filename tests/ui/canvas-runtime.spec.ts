import { expect, type Page, test } from '@playwright/test';

/**
 * `/canvas-runtime` Web 隔离入口的稳定 Playwright 契约测试（阶段 7）。
 *
 * 覆盖两条互斥画布路径：
 *  1) 正常路径：默认 legacy → 显式切 Skia → Skia smoke 挂载 → 手动回 legacy；
 *  2) 失败路径：本地阻断 CanvasKit WASM 后进入可见 error，retry/back 可操作，
 *     绝不自动回退 legacy；点击 back 后 legacy 恢复。
 *
 * 断言依据 `CanvasRuntimeRoute.web.tsx` 的稳定 testID（react-native-web 映射为
 * data-testid）与条件渲染结构：任一时刻至多挂载一个画布（legacy SVG 或 Skia canvas）。
 */

/** 稳定 testID 常量，避免测试里散落硬编码字符串 */
const TEST_ID = {
  root: 'canvas-runtime-root',
  mode: 'canvas-runtime-mode',
  legacySurface: 'canvas-runtime-legacy-surface',
  legacyDrawing: 'canvas-runtime-legacy-drawing',
  switchSkia: 'canvas-runtime-switch-skia',
  loading: 'canvas-runtime-loading',
  skiaSurface: 'canvas-runtime-skia-surface',
  error: 'canvas-runtime-error',
  retry: 'canvas-runtime-retry',
  backLegacy: 'canvas-runtime-back-legacy',
} as const;

/**
 * 仅过滤明确与产品逻辑无关的环境噪声（devtools 提示 / favicon / HMR 连接等）。
 * 不做过宽的“白名单”，以免掩盖真正的产品 console error。
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
 * Expo 开发服务器会在 WASM 请求失败时注入开发期错误覆盖层；它并非产品运行时的一部分，
 * 却会遮挡错误态中的真实按钮。仅在需要点击产品错误态按钮前移除它。
 */
async function removeExpoErrorOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('#error-overlay').forEach((element) => {
      element.remove();
    });
  });
}

/** 等待 retry 的整页刷新，而不是把当前页面的已完成 load state 当作新导航。 */
function waitForMainFrameReload(page: Page): Promise<void> {
  return page
    .waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 30_000,
    })
    .then(() => undefined);
}

test.describe('/canvas-runtime 画布运行时契约', () => {
  test('正常路径：legacy 默认可见，切 Skia 后互斥挂载，返回 legacy 恢复', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    await page.goto('/canvas-runtime');

    // 默认：只挂 legacy，Skia / 错误态均不存在
    await expect(page.getByTestId(TEST_ID.root)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.legacySurface)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.legacyDrawing)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.switchSkia)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.error)).toHaveCount(0);

    // 显式切换到 Skia：legacy 立即卸载，进入 loading（或加载极快时已到 skia）
    await page.getByTestId(TEST_ID.switchSkia).click();
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.legacyDrawing)).toHaveCount(0);
    const loadingOrSkia = page
      .getByTestId(TEST_ID.loading)
      .or(page.getByTestId(TEST_ID.skiaSurface));
    await expect(loadingOrSkia).toBeVisible();

    // 等待 Skia smoke 画布挂载完成
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId(TEST_ID.loading)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.error)).toHaveCount(0);

    // 互斥性：此时仅有一个 <canvas>（Skia），且 legacy 不在 DOM
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);

    // 手动返回 legacy：Skia 卸载，legacy 恢复
    await page.getByTestId(TEST_ID.backLegacy).click();
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.legacySurface)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.legacyDrawing)).toBeVisible();

    // 正常流程不应产生产品级 console error / pageerror
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('失败路径：阻断本地 CanvasKit WASM 后进入可见 error，绝不自动回退 legacy', async ({
    page,
  }) => {
    // 在导航前阻断本地 WASM 请求（locateFile 返回 `/canvaskit.wasm`）
    await page.route('**/canvaskit.wasm', (route) => route.abort());

    await page.goto('/canvas-runtime');
    await expect(page.getByTestId(TEST_ID.legacySurface)).toBeVisible();

    // 切换到 Skia，加载失败应进入本地可见 error
    await page.getByTestId(TEST_ID.switchSkia).click();
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.error)).toBeVisible({ timeout: 60000 });

    // error 态下：retry / back 可见且可操作；legacy 不得自动回来
    await expect(page.getByTestId(TEST_ID.retry)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.retry)).toBeEnabled();
    await expect(page.getByTestId(TEST_ID.backLegacy)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.backLegacy)).toBeEnabled();
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toHaveCount(0);

    // 不点击 retry（整页 reload 会引入不稳定）；仅点击 back 验证可回退。
    // Expo dev server 会在 WASM 请求失败时注入 `#error-overlay` 覆盖层拦截指针，
    // 这是开发环境噪声而非产品行为，故先移除该覆盖层再点击。
    await removeExpoErrorOverlay(page);
    await page.getByTestId(TEST_ID.backLegacy).click();
    await expect(page.getByTestId(TEST_ID.error)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.legacySurface)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.legacyDrawing)).toBeVisible();
  });

  test('一次性重试：解除 WASM 阻断后刷新直接加载 Skia，不闪现 legacy', async ({ page }) => {
    let blockWasm = true;
    await page.route('**/canvaskit.wasm', (route) => (blockWasm ? route.abort() : route.continue()));

    await page.goto('/canvas-runtime');
    await page.getByTestId(TEST_ID.switchSkia).click();
    await expect(page.getByTestId(TEST_ID.error)).toBeVisible({ timeout: 60_000 });

    // 解除阻断后，retry 写入 sessionStorage 并 reload；初始渲染必须直接进入 loading。
    blockWasm = false;
    await removeExpoErrorOverlay(page);
    const reload = waitForMainFrameReload(page);
    const wasmResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
      { timeout: 60_000 },
    );
    // 开发服务器可能在移除后又插入 #error-overlay；force 只绕过该开发覆盖层，
    // 事件仍派发给真实的 retry 按钮。
    await page.getByTestId(TEST_ID.retry).click({ force: true });
    await reload;

    const loadingOrSkia = page
      .getByTestId(TEST_ID.loading)
      .or(page.getByTestId(TEST_ID.skiaSurface));
    await expect(loadingOrSkia).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.error)).toHaveCount(0);

    const response = await wasmResponse;
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    expect(response.headers()['content-type']).toContain('application/wasm');
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
  });

  test('持续失败的重试：刷新后回到 error，仍可再次重试或手动返回 legacy', async ({ page }) => {
    await page.route('**/canvaskit.wasm', (route) => route.abort());

    await page.goto('/canvas-runtime');
    await page.getByTestId(TEST_ID.switchSkia).click();
    await expect(page.getByTestId(TEST_ID.error)).toBeVisible({ timeout: 60_000 });

    await removeExpoErrorOverlay(page);
    const reload = waitForMainFrameReload(page);
    // 同上：仅绕过 Expo 开发期错误覆盖层，不改变产品事件路径。
    await page.getByTestId(TEST_ID.retry).click({ force: true });
    await reload;

    await expect(page.getByTestId(TEST_ID.error)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(TEST_ID.retry)).toBeEnabled();
    await expect(page.getByTestId(TEST_ID.backLegacy)).toBeEnabled();
    await expect(page.getByTestId(TEST_ID.legacySurface)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.skiaSurface)).toHaveCount(0);
  });
});
