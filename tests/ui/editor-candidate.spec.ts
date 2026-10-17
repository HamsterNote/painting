import { chromium, expect, type Browser, type Locator, type Page, test } from '@playwright/test';

/** Playwright Node 运行时提供 Buffer；测试工程未显式引入 @types/node，故在此最小化声明。 */
declare const Buffer: {
  from(input: string, encoding: 'base64'): Uint8Array;
};

/**
 * 候选编辑器（正式根 `/`）Web 隔离入口的有界持久 Playwright Chromium E2E。
 *
 * 本文件覆盖候选编辑器第一、第二及**第三纵切**，并覆盖**候选选框（Web-only）**：
 * 第三纵切验证 Web 文本 composition、文本取消/既有文本编辑与图片资源导入；选框用例验证
 * 套索选中后的移动、旋转、**四角等比缩放**与取消。每例均加载同源真实 CanvasKit 并断言没有
 * 产品错误。
 *
 * 重要边界声明（证据强度）：
 *  - 本文件仅覆盖 **Chromium Web + 同源真实 CanvasKit**，等待真实 `<canvas>` 挂载后再操作；
 *    它不是 native（iOS/Android）行为验证，也不是像素/截图/颜色比对、性能基线，更**不是
 *    OpenSpec 任务 7.4 已完成的证据**；
 *  - 只断言 DOM 语义（testID / title / 可访问名称）与 core 暴露的计数 / history / selection
 *    文本，绝不把“存在一个 `<canvas>`”当作像素渲染或原生能力证明；
 *  - 选框用例验证的是 core 相似变换契约（move / rotate / 四角等比 uniform-scale），只通过既有
 *    DOM 手柄拖拽，不访问 React state，也**不假设任何边中点或 resize selector**；它是
 *    Web-local 契约证据，不覆盖 native 手势、像素/截图、性能，也不代表 OpenSpec 任务 7.4 完成；
 *  - 每个用例都在自身内准备数据（独立打开页面），不依赖同一文件内其它用例的执行顺序。
 *
 * 断言依据 `EditorCandidateSurface.web.tsx` / `EditorCandidateRoute.web.tsx` 暴露的稳定
 * testID（react-native-web 映射为 data-testid）与确定性计数文本。
 */

/** 稳定 testID 常量，避免测试里散落硬编码字符串 */
const TEST_ID = {
  root: 'editor-candidate-root',
  canvas: 'editor-candidate-canvas',
  count: 'editor-candidate-count',
  selectionCount: 'editor-candidate-selection-count',
  history: 'editor-candidate-history',
  undo: 'editor-candidate-undo',
  redo: 'editor-candidate-redo',
  clear: 'editor-candidate-clear',
  clearSelection: 'editor-candidate-clear-selection',
  status: 'editor-candidate-status',
  toolPen: 'editor-candidate-tool-pen',
  textCreate: 'editor-candidate-text-create',
  textArea: 'editor-candidate-textarea',
  textDone: 'editor-candidate-text-done',
  textCancel: 'editor-candidate-text-cancel',
  imageImport: 'editor-candidate-image-import',
  imageFileInput: 'editor-candidate-image-file-input',
  imageImportStatus: 'editor-candidate-image-import-status',
  resourceCount: 'editor-candidate-resource-count',
  imageReleaseDiagnostics: 'editor-candidate-image-release-diagnostics',
  polygonFinish: 'editor-candidate-polygon-finish',
  polygonCancel: 'editor-candidate-polygon-cancel',
  bezierCancel: 'editor-candidate-bezier-cancel',
  selectionTransform: 'editor-candidate-selection-transform',
  selectionFrame: 'selection-frame',
  selectionPreview: 'selection-preview',
  selectionRotateHandle: 'selection-rotate-handle',
  selectionHandlePrefix: 'selection-handle-',
  panToggle: 'editor-candidate-pan-toggle',
  ruler: 'editor-candidate-ruler',
  rulerStatus: 'editor-candidate-ruler-status',
  rulerRotation: 'editor-candidate-ruler-rotation',
  rulerBackground: 'drawing-ruler-background',
  // 候选导航纵切新增的两个瞬时反馈浮层（回调内渲染，随超时/手势结束清理）。
  zoomFeedback: 'editor-candidate-zoom-feedback',
  rulerAngleFeedback: 'editor-candidate-ruler-angle-feedback',
  routeLoading: 'editor-candidate-route-loading',
  routeError: 'editor-candidate-route-error',
  lifecycleDiagnostics: 'editor-candidate-lifecycle-diagnostics',
  surfaceDiagnostics: 'editor-candidate-surface-diagnostics',
  canvasDiagnostics: 'editor-candidate-canvas-diagnostics',
  performanceDiagnostics: 'editor-candidate-performance-diagnostics',
} as const;

/**
 * 尺子鼠标修饰键的平台等价物：macOS 用 Meta（⌘），其它平台用 Control。
 * 产品 core 对 alt / ctrl / meta 一视同仁，因此这里只做平台兼容而非产品分支。
 */
const RULER_PRIMARY_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * 候选编辑器正式根路径。根切换后所有候选 E2E 默认从此打开；显式产品路径与
 * `?diagnostics=...` 查询也一律拼在此根路径上。集中为单一常量，避免测试散落硬编码。
 */
const EDITOR_PATH = '/';

/**
 * `/editor-candidate` 仅作为不动作的兼容/诊断别名保留；只允许在“兼容别名单独证明”
 * 用例中出现，绝不用于掩盖根路径失败。
 */
const EDITOR_ALIAS_PATH = '/editor-candidate';

/** 三个纵切已启用、点击可切换的对象工具 testID 后缀 */
const ENABLED_TOOL_IDS = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'eraser',
  'lasso',
  'text',
  'image',
] as const;

/** 内联 1×1 PNG 的 base64 字节，覆盖真实浏览器 FileReader / Image / CanvasKit 解码路径。 */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/' +
  'ScL9kAAAAABJRU5ErkJggg==';

/** 内容不同的有效 1×1 PNG，确保第二次资源导入不会走既有 data URL 去重路径。 */
const SECOND_ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQrvr/HwAE/AKcYb9TcwAAAABJRU5ErkJggg==';

/**
 * 合法且很小的 RGBA PNG：IHDR 声明 8193×1，超过产品 8192 px 边长限制。
 * 压缩零像素行仅 111 B，避免为了验证维度拒绝而分配大文件。
 */
const OVER_EDGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAIAEAAAABCAYAAACZiUteAAAANklEQVR4nO3BAQ0AAADCoPdP7WYOoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAG4AFAAEdCyhIAAAAAElFTkSuQmCC';

/**
 * 仅过滤明确与产品逻辑无关的环境噪声（DevTools 提示 / favicon / HMR WebSocket 等）。
 * 不做更宽的白名单，任何产品级 console error / pageerror 都必须导致失败。
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
 * 默认路径不暴露 diagnostics 节点，因此失败时保留路由与真实 Canvas 的最后 DOM 快照，避免把
 * renderer crash 或 route error 误报成生命周期稳定。
 */
async function captureCandidateSnapshot(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const attributes = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        return element
          ? Object.fromEntries(
              [...element.attributes].map((attribute) => [attribute.name, attribute.value])
            )
          : null;
      };
      return JSON.stringify({
        root: attributes('editor-candidate-root'),
        routeLoading: attributes('editor-candidate-route-loading'),
        routeError: attributes('editor-candidate-route-error'),
        canvasHost: attributes('editor-candidate-canvas'),
        canvasCount: document.querySelectorAll('canvas').length,
      });
    });
  } catch {
    return null;
  }
}

/**
 * 根切 canary 关注的历史 legacy 标识：这些字符串只属于 legacy 多 demo。
 */
const LEGACY_MARKERS = [
  'drawing-tool-toolbar',
  'drawing-surface-uncontrolled',
  'painting-board',
  'painting-board-demo-a',
] as const;

/** canary 在浏览器上下文累积、可序列化回 Node 的状态。 */
interface RootSwitchCanaryState {
  anyLegacy: boolean;
  legacyMarkersSeen: string[];
  maxCanvasCount: number;
  mutationCount: number;
}

/**
 * 在首个 DOM mutation 起安装 MutationObserver，记录是否曾出现任何 legacy 标识，并跟踪
 * canvas 数量的历史最大值。必须在任何 `goto` 之前调用：`addInitScript` 会在后续导航的
 * 文档脚本之前先行执行，因此能看到候选编辑器挂载的完整 DOM 变更历史。
 */
async function installRootSwitchCanary(page: Page): Promise<void> {
  await page.addInitScript(
    ({ markers }: { markers: readonly string[] }) => {
      const state = {
        anyLegacy: false,
        legacyMarkersSeen: [] as string[],
        maxCanvasCount: 0,
        mutationCount: 0,
      };
      (window as unknown as { __rootSwitchCanary: typeof state }).__rootSwitchCanary = state;

      // 只扫描新增子树即可命中断言标识：React Native Web 在元素创建时即写入 testID。
      const scan = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const candidate = node as { outerHTML?: unknown; textContent?: unknown };
        const html =
          typeof candidate.outerHTML === 'string'
            ? candidate.outerHTML
            : typeof candidate.textContent === 'string'
              ? candidate.textContent
              : '';
        const haystack = html.toLowerCase();
        for (const marker of markers) {
          if (!state.legacyMarkersSeen.includes(marker) && haystack.includes(marker)) {
            state.legacyMarkersSeen.push(marker);
            state.anyLegacy = true;
          }
        }
      };

      const countCanvas = () => {
        const count = document.querySelectorAll('canvas').length;
        if (count > state.maxCanvasCount) {
          state.maxCanvasCount = count;
        }
      };

      const observer = new MutationObserver((records) => {
        state.mutationCount += 1;
        for (const record of records) {
          record.addedNodes.forEach((node: unknown) => scan(node));
        }
        countCanvas();
      });
      observer.observe(document, { childList: true, subtree: true });
      countCanvas();
    },
    { markers: LEGACY_MARKERS }
  );
}

/** 读回 canary 状态；未安装时返回空状态而非抛错，避免掩盖真正的断言失败。 */
async function readRootSwitchCanary(page: Page): Promise<RootSwitchCanaryState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __rootSwitchCanary?: RootSwitchCanaryState })
      .__rootSwitchCanary;
    return (
      state ?? { anyLegacy: false, legacyMarkersSeen: [], maxCanvasCount: 0, mutationCount: 0 }
    );
  });
}

/**
 * 进入候选编辑器根路径（默认 `/`）并等待真实 CanvasKit 从同源 `/canvaskit.wasm` 加载、
 * 候选 surface 挂载完成。开发服务器可能“假 ready”（端口已开但 bundle/路由尚未就绪），
 * 因此以 canvas 挂载作为可靠就绪信号，而不是只看 goto 返回或 root 存在。
 */
async function openCandidateEditor(page: Page, path = EDITOR_PATH): Promise<void> {
  // 在导航前登记 WASM 响应等待：路由挂载即触发本地加载。
  const wasmResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
    { timeout: 90_000 }
  );

  await page.goto(path);

  // root 在 loading / surface 两种状态下都会出现，仅作为路由已命中的信号。
  await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
  // canvas host 只在 CanvasKit 初始化成功后的 surface 中出现，是可靠就绪信号。
  await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible({ timeout: 90_000 });
  // 不应停留在 route loading / error 失败态。缺失 testID 时 locator 不匹配任何元素，
  // `.not.toBeVisible()` 判定为通过且始终返回确定的可见性结果，避开 toHaveCount 在元素
  // 缺失时可能报 "Received undefined" 的 matcher 兼容问题；一旦 loading/error 元素可见
  // 即断言失败，失败态防线仍然保留。
  await expect(page.getByTestId(TEST_ID.routeLoading)).not.toBeVisible();
  await expect(page.getByTestId(TEST_ID.routeError)).not.toBeVisible();
  // 真实 CanvasKit 只挂载一个 <canvas>。
  await expect(page.locator('canvas')).toHaveCount(1);

  const response = await wasmResponse;
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
  expect(new URL(response.url()).pathname).toBe('/canvaskit.wasm');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/wasm');
}

/** 画布 host 归一化坐标：fx / fy 为相对 host 宽高的比例。 */
type CanvasFraction = Readonly<{ fx: number; fy: number }>;

/** 画布上共享的稳定绘制区域，保证形状/橡皮/套索用例可独立复现。 */
const PEN_START: CanvasFraction = { fx: 0.3, fy: 0.4 };
const PEN_END: CanvasFraction = { fx: 0.6, fy: 0.6 };

/**
 * 环绕 PEN_START→PEN_END 笔迹的闭合套索路径；与既有 lasso 用例同源，
 * 用于稳定地产生“恰好选中 1 条”的候选选框。
 */
const SELECTION_LASSO_PATH = [
  { fx: 0.18, fy: 0.2 },
  { fx: 0.7, fy: 0.24 },
  { fx: 0.68, fy: 0.78 },
  { fx: 0.2, fy: 0.74 },
  { fx: 0.24, fy: 0.3 },
] as const;

/** 候选选框唯一合法的四个等比缩放角手柄 testID（不含旋转手柄，也不含边中点）。 */
const SELECTION_CORNER_HANDLE_IDS = [
  'selection-handle-top-left',
  'selection-handle-top-right',
  'selection-handle-bottom-right',
  'selection-handle-bottom-left',
] as const;

/** 读取画布 host 的可操作 bounding box；不可用时直接失败而非继续猜测坐标。 */
async function canvasBox(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const canvasHost = page.getByTestId(TEST_ID.canvas);
  await expect(canvasHost).toBeVisible();
  const box = await canvasHost.boundingBox();
  if (!box) {
    throw new Error('editor-candidate-canvas 没有可用的 bounding box');
  }
  return box;
}

/** 比例坐标 → 页面绝对坐标（落在 host 内）。 */
function atFraction(
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
  fraction: CanvasFraction
): { x: number; y: number } {
  return { x: box.x + box.width * fraction.fx, y: box.y + box.height * fraction.fy };
}

/** 在画布上拖拽：down(start) → move(end, steps) → up(end)。 */
async function dragCanvas(
  page: Page,
  from: CanvasFraction,
  to: CanvasFraction,
  steps = 8
): Promise<void> {
  const box = await canvasBox(page);
  const start = atFraction(box, from);
  const end = atFraction(box, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/** 在画布上沿多点路径拖拽一个手势；用于套索等需要多个顶点的闭合轮廓。 */
async function dragPath(page: Page, points: readonly CanvasFraction[], steps = 6): Promise<void> {
  const box = await canvasBox(page);
  const [first, ...rest] = points;
  const start = atFraction(box, first);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of rest) {
    const target = atFraction(box, point);
    await page.mouse.move(target.x, target.y, { steps });
  }
  await page.mouse.up();
}

/** 在画布上做一次离散点击（down + up），用于 polygon/bezier 的逐点顶点。 */
async function clickCanvas(page: Page, at: CanvasFraction): Promise<void> {
  const box = await canvasBox(page);
  const point = atFraction(box, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** 通过稳定 testID 选择工具；工具切换本身绝不写入 history。 */
async function selectTool(page: Page, toolSuffix: string): Promise<void> {
  await page.getByTestId(`editor-candidate-tool-${toolSuffix}`).click();
}

/** 在画布 host 上用鼠标 pointer 绘制一笔。多步 move 确保 pen 候选为非退化几何可提交。 */
async function drawMouseStroke(page: Page): Promise<void> {
  await dragCanvas(page, PEN_START, PEN_END);
}

/**
 * 建立“先 pen 绘制一笔 → 切 lasso → 闭合套索选中 1 条”的候选选择生命周期。
 * 断言到选择与 history 的稳定文本，供后续选框变换用例复用。
 */
async function selectSinglePenStrokeWithLasso(page: Page): Promise<void> {
  await drawMouseStroke(page);
  await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
  await expectHistory(page, 1, 0);

  await selectTool(page, 'lasso');
  await dragPath(page, SELECTION_LASSO_PATH);
  await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
  // 套索只更新选择，绝不写入 history。
  await expectHistory(page, 1, 0);
}

/** 读取某个 testID 元素的可操作中心点；不可用时直接失败而非继续猜测坐标。 */
async function centerOfTestId(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${testId} 没有可用的 bounding box`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 读取 testID 元素的 bounding box；不可用时直接失败。 */
async function boxOfTestId(
  page: Page,
  testId: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${testId} 没有可用的 bounding box`);
  }
  return box;
}

/** 断言计数 / history / selection 的稳定文本。 */
async function expectHistory(page: Page, undoDepth: number, redoDepth: number): Promise<void> {
  await expect(page.getByTestId(TEST_ID.history)).toContainText(
    `Undo depth ${undoDepth} · Redo depth ${redoDepth}`
  );
}

/** 文档写入、undo 或 redo 后，core 生命周期必须撤销失效的 selection 及其全部视觉残留。 */
async function expectSelectionCleared(page: Page): Promise<void> {
  await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 0');
  await expect(page.getByTestId(TEST_ID.selectionFrame)).toHaveCount(0);
  await expect(page.getByTestId(TEST_ID.selectionPreview)).toHaveCount(0);
}

/**
 * 读取候选尺子背景层的内联样式，作为“尺子位置/旋转是否变化”的 observable 信号。
 *
 * 产品只把尺子旋转角渲染成文本，位置没有公开文本；因此这里只对比 DOM style 的变化，
 * 不把它当作像素、native 或多触能力的证据。
 */
async function readRulerStyle(
  page: Page
): Promise<{ left: string; top: string; transform: string }> {
  return page.getByTestId(TEST_ID.rulerBackground).evaluate((element) => {
    // 测试工程未引入 DOM lib，这里用最小结构类型读取内联样式，避免新增类型依赖。
    const style = (
      element as unknown as { style: { left: string; top: string; transform: string } }
    ).style;
    return { left: style.left, top: style.top, transform: style.transform };
  });
}

test.describe('候选编辑器根路径（/）Chromium Web CanvasKit 三纵切契约', () => {
  test('默认路径首次挂载安全且稳定：实际 Canvas 无重复挂卸，pen 提交一条 history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    const crashes: string[] = [];
    let lastSnapshot = '未能读取任何默认路径快照';
    page.on('crash', () => {
      crashes.push('page crash');
    });

    try {
      // 明确不携带 diagnostics/diagStage，覆盖候选产品默认入口而不是 D1-D4 二分分支。
      await openCandidateEditor(page, EDITOR_PATH);
      lastSnapshot = (await captureCandidateSnapshot(page)) ?? lastSnapshot;

      // 从真实 Canvas 已存在的时点开始观察。childList 同时捕获 Canvas 重新挂载与卸载，
      // 不把静态的 count=1 误当作 1.2 秒内生命周期稳定。
      const lifecycle = await page.evaluate(async () => {
        const host = document.querySelector('[data-testid="editor-candidate-canvas"]');
        if (!host) throw new Error('默认路径没有 editor-candidate-canvas host');
        let canvasAdds = 0;
        let canvasRemovals = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof HTMLCanvasElement || node.querySelector?.('canvas'))
                canvasAdds += 1;
            }
            for (const node of record.removedNodes) {
              if (node instanceof HTMLCanvasElement || node.querySelector?.('canvas'))
                canvasRemovals += 1;
            }
          }
        });
        observer.observe(host, { childList: true, subtree: true });
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        observer.disconnect();
        return { canvasAdds, canvasRemovals, canvasCount: host.querySelectorAll('canvas').length };
      });
      expect(lifecycle).toEqual({ canvasAdds: 0, canvasRemovals: 0, canvasCount: 1 });
      await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);

      // 确认稳定窗口后仍可由真实 pointer 路径绘制，并只提交一次 document/history。
      await drawMouseStroke(page);
      await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
      await expectHistory(page, 1, 0);
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
      lastSnapshot = (await captureCandidateSnapshot(page)) ?? lastSnapshot;

      expect(crashes).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } catch (error) {
      lastSnapshot = (await captureCandidateSnapshot(page)) ?? lastSnapshot;
      throw new Error(
        `默认 candidate 首次挂载或生命周期稳定性异常；crashes=${JSON.stringify(crashes)}; ` +
          `consoleErrors=${JSON.stringify(consoleErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ` +
          `last=${lastSnapshot}; cause=${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  test('同源 CanvasKit：/canvaskit.wasm 返回 200 application/wasm，正常路径无产品错误', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    await openCandidateEditor(page);

    // 初始终注意义：0 笔迹，history 都为空。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 0');

    // 正常加载流程不应产生产品级 console error / pageerror。
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('perf query 默认关闭，启用时只暴露可序列化、带事件关联语义的原始测量接口', async ({
    page,
  }) => {
    await openCandidateEditor(page);
    expect(
      await page.evaluate(
        () => typeof (window as Window & { __hamsterEditorPerf?: unknown }).__hamsterEditorPerf
      )
    ).toBe('undefined');
    await expect(page.getByTestId(TEST_ID.performanceDiagnostics)).toHaveCount(0);

    await openCandidateEditor(page, '/?perf=1');
    await expect(page.getByTestId(TEST_ID.performanceDiagnostics)).toHaveAttribute(
      'data-workload-strokes',
      '100000'
    );
    const snapshot = await page.evaluate(() => {
      const api = (
        window as Window & {
          __hamsterEditorPerf?: {
            getSnapshot: () => unknown;
            runRebaseProbe: () => unknown;
            resetMeasurements: () => void;
            runHighRatePenInput: (options: {
              eventsPerSecond: number;
              durationMs: number;
            }) => Promise<unknown>;
          };
        }
      ).__hamsterEditorPerf;
      if (!api) throw new Error('perf API is unavailable');
      api.resetMeasurements();
      return api.runHighRatePenInput({ eventsPerSecond: 10, durationMs: 200 }).then((run) => ({
        snapshot: api.getSnapshot(),
        rebase: api.runRebaseProbe(),
        run,
      }));
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot).toMatchObject({
      snapshot: {
        version: 1,
        mode: 'enabled',
        workload: { strokeCount: 100_000 },
        // 两个正式 adapter 事件组成一笔，并在 up 时真实提交；workload 本身仍固定 100,000。
        document: { strokeCount: 100_001 },
      },
      rebase: { version: 1 },
    });
    const samples = (
      snapshot as unknown as {
        snapshot: { measurements: { pointerSamples: unknown[] } };
      }
    ).snapshot.measurements.pointerSamples as Array<{
      eventId: string;
      sequence: number;
      emittedAt: number;
      receivedAt: number;
      nextFrameAt: number;
      invalidReason: string | null;
    }>;
    expect(samples).toHaveLength(2);
    expect(samples.map((sample) => sample.eventId)).toEqual(
      expect.arrayContaining([expect.any(String)])
    );
    expect(samples.map((sample) => sample.sequence)).toEqual([1, 2]);
    expect(samples.every((sample) => sample.invalidReason === null)).toBe(true);
    expect(
      samples.every(
        (sample) => sample.nextFrameAt >= sample.receivedAt && sample.receivedAt >= sample.emittedAt
      )
    ).toBe(true);
  });

  test('鼠标 pointer 绘制一笔：笔迹 0→1、Undo depth 0→1，undo 回 0、redo 回 1', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(page.getByTestId(TEST_ID.undo)).toBeDisabled();

    await drawMouseStroke(page);

    // 提交后：1 笔迹、undo depth 1、redo 空；undo 可用。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 0');
    await expect(page.getByTestId(TEST_ID.undo)).toBeEnabled();

    // undo：回到 0 笔迹，redo depth 1。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 1');

    // redo：恢复到 1 笔迹，undo depth 1。
    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('清空已套索选择的对象后，以及 undo/redo 后都不保留失效选框', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 0');
    await selectTool(page, 'lasso');
    await dragPath(page, SELECTION_LASSO_PATH);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();

    // clear：所有笔迹移除，且作为一条可撤销 history 提交（undo depth 2）。
    await page.getByTestId(TEST_ID.clear).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 2 · Redo depth 0');
    await expectSelectionCleared(page);

    // undo：恢复 1 笔迹；被撤销的 clear 成为一条 redo 记录（Redo depth 1），不复活旧 selection。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 1 · Redo depth 1');
    await expectSelectionCleared(page);

    // redo：再次清空对象，旧 targets/overlay/preview 仍不得回流。
    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 2 · Redo depth 0');
    await expectSelectionCleared(page);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('平移控件改变 viewport 状态但不改 history', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 初始视口为 0,0，history 为空。
    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 0');

    // 稳定首选平移控件：无 testID，按 role + 可访问名称定位。
    await page.getByRole('button', { name: '向右平移画布' }).click();

    // 视口 tx 改变（+80），且 history 完全不变。
    await expect(page.getByText('视口 80, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 0');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');

    // 再向左平移回到 0，history 仍不变。
    await page.getByRole('button', { name: '向左平移画布' }).click();
    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.history)).toContainText('Undo depth 0 · Redo depth 0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('三条纵切工具均可选，selection-transform 与 ruler 的当前能力如实标注', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 10 个工具全部可见且可交互；Pen 默认选中。
    for (const toolId of ENABLED_TOOL_IDS) {
      const tool = page.getByTestId(`editor-candidate-tool-${toolId}`);
      await expect(tool).toBeVisible();
      await expect(tool).toBeEnabled();
    }
    await expect(page.getByTestId(TEST_ID.toolPen)).toHaveAttribute('aria-label', /已启用/);

    await expect(page.getByTestId(TEST_ID.selectionTransform)).toHaveText(
      '选框变换：移动、旋转、四角等比缩放'
    );
    await expect(page.getByTestId(TEST_ID.rulerStatus)).toHaveText('尺子：core 手势已接入');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('文本：composition 未结束时完成不提交，结束后恰好提交一次且 Enter 只换行', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await page.getByTestId(TEST_ID.textCreate).click();
    const editor = page.getByTestId(TEST_ID.textArea);
    const done = page.getByTestId(TEST_ID.textDone);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('');

    // Playwright 不模拟系统 IME，因此显式派发 Web composition 生命周期事件。
    await editor.dispatchEvent('compositionstart');
    await editor.fill('中文');
    await editor.press('Enter');
    // 物理 Enter 只插入换行，草稿期间 document/history 必须始终不变。
    await expect(editor).toHaveValue('中文\n');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    await editor.fill('中文\nemoji 👨‍👩‍👧‍👦');
    await expect(editor).toHaveValue('中文\nemoji 👨‍👩‍👧‍👦');
    await done.click();
    // 完成仅请求提交；composition 仍进行时 textarea 及零变更状态都必须保留。
    await expect(editor).toBeVisible();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    await editor.dispatchEvent('compositionend');
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('文本取消不写入；稳定既有文本入口编辑只新增一条 history，undo 恢复原文', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 新建草稿后取消，document 与 history 均为初始值。
    await page.getByTestId(TEST_ID.textCreate).click();
    const editor = page.getByTestId(TEST_ID.textArea);
    await editor.fill('取消的草稿');
    await page.getByTestId(TEST_ID.textCancel).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 当前 surface 公开每条已提交文本的稳定 edit testID，因此真实覆盖 existing 编辑路径。
    const original = '原始文本';
    const edited = '编辑后的文本';
    await page.getByTestId(TEST_ID.textCreate).click();
    await editor.fill(original);
    await page.getByTestId(TEST_ID.textDone).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    const editButton = page.locator('[data-testid^="editor-candidate-text-edit-"]');
    await expect(editButton).toHaveCount(1);
    await editButton.click();
    await expect(editor).toHaveValue(original);
    await editor.fill(edited);
    // 编辑草稿不产生 history，完成后才从 1 精确变为 2。
    await expectHistory(page, 1, 0);
    await page.getByTestId(TEST_ID.textDone).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 2, 0);

    // 撤销这一条 existing 编辑后，重新打开编辑器验证精确恢复原文；取消只关闭验证会话。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 1);
    await editButton.click();
    await expect(editor).toHaveValue(original);
    await page.getByTestId(TEST_ID.textCancel).click();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('图片：内联有效 PNG 导入后资源、笔迹与 history 各加一，undo 回退 document/history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const fileInput = page.getByTestId(TEST_ID.imageFileInput);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 0');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 通过实际 file input 上传内联 PNG；不对浏览器取消事件作不稳定的伪断言。
    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles({
      name: 'one-pixel.png',
      mimeType: 'image/png',
      // setInputFiles 要求运行时真实 Node Buffer；base64 字节避免额外 fixture 文件。
      buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64') as never,
    });

    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('已导入 1×1');
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('line/rect/ellipse 各拖拽一次：计数与 history 各 +1', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    const shapes = [
      { tool: 'line', expected: 1 },
      { tool: 'rect', expected: 2 },
      { tool: 'ellipse', expected: 3 },
    ] as const;

    for (const { tool, expected } of shapes) {
      await selectTool(page, tool);
      // 拖拽的 x/y 均不同，保证 rect/ellipse 非退化；松手只提交一次。
      await dragCanvas(page, { fx: 0.25, fy: 0.3 }, { fx: 0.5, fy: 0.6 });
      await expect(page.getByTestId(TEST_ID.count)).toContainText(`笔迹 ${expected}`);
      await expectHistory(page, expected, 0);
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('polygon 三点后完成按钮由 disabled 转 enabled 且只提交一次，取消候选零 history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectTool(page, 'polygon');

    const finish = page.getByTestId(TEST_ID.polygonFinish);
    const cancel = page.getByTestId(TEST_ID.polygonCancel);
    // 无顶点时完成与取消都不可用。
    await expect(finish).toBeDisabled();
    await expect(cancel).toBeDisabled();

    // 三个非共线顶点。
    await clickCanvas(page, { fx: 0.3, fy: 0.3 });
    await clickCanvas(page, { fx: 0.55, fy: 0.35 });
    await clickCanvas(page, { fx: 0.4, fy: 0.6 });

    await expect(finish).toBeEnabled();
    await finish.click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    // 取消候选：再添加两个顶点后取消，只丢弃候选，不新增 history。
    await clickCanvas(page, { fx: 0.7, fy: 0.3 });
    await clickCanvas(page, { fx: 0.75, fy: 0.5 });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('bezier 点四次后第四点自动提交一次，history +1', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectTool(page, 'bezier');

    const points = [
      { fx: 0.3, fy: 0.3 },
      { fx: 0.45, fy: 0.6 },
      { fx: 0.6, fy: 0.3 },
      { fx: 0.72, fy: 0.6 },
    ] as const;

    for (const point of points.slice(0, 3)) {
      await clickCanvas(page, point);
      // 前三个控制点只构造候选，不写 history。
      await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
      await expectHistory(page, 0, 0);
    }

    // 第四点在 canvas pointer down 时自动完成并提交一次。
    await clickCanvas(page, points[3]);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('eraser 删除已套索选择的对象后，undo/redo 不显示陈旧 selection', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);

    // 命中场景：先画一笔（1 笔迹 / Undo 1），再用橡皮沿同一路径拖拽删除。
    await openCandidateEditor(page);
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    await selectTool(page, 'lasso');
    await dragPath(page, SELECTION_LASSO_PATH);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();

    await selectTool(page, 'eraser');
    // 从选框外开始，避免选框的优先命中将手势路由为 transform；轨迹仍穿过原 pen。
    await dragCanvas(page, { fx: 0.18, fy: 0.2 }, { fx: 0.7, fy: 0.78 });
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 2, 0);
    await expectSelectionCleared(page);

    // undo 只撤销这一条橡皮提交并恢复对象，但不复活删除前的 selection。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 1);
    await expectSelectionCleared(page);

    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 2, 0);
    await expectSelectionCleared(page);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('eraser 未命中对象时不改变计数也不增加 history', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    await selectTool(page, 'eraser');
    // 远离已绘制笔迹的空白区域拖拽，预期零命中。
    await dragCanvas(page, { fx: 0.85, fy: 0.8 }, { fx: 0.92, fy: 0.9 });

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('lasso 更新选择但不写 history，clear-selection 只清选择', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 0');

    await selectTool(page, 'lasso');
    // 围绕刚绘制的笔迹拖拽一个闭合的简单多边形套索（多点 move 提供 ≥3 个有效顶点）。
    await dragPath(page, [
      { fx: 0.18, fy: 0.2 },
      { fx: 0.7, fy: 0.24 },
      { fx: 0.68, fy: 0.78 },
      { fx: 0.2, fy: 0.74 },
      { fx: 0.24, fy: 0.3 },
    ]);

    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expectHistory(page, 1, 0);

    // clear-selection 只清空选择，不写入 history、不改变对象数。
    const clearSelection = page.getByTestId(TEST_ID.clearSelection);
    await expect(clearSelection).toBeEnabled();
    await clearSelection.click();
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 0');
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('删除已套索选择的文本后，undo/redo 不显示陈旧 selection', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 从画布创建文本，使其与通用套索路径处于同一稳定操作区域。
    await selectTool(page, 'text');
    await clickCanvas(page, PEN_START);
    const editor = page.getByTestId(TEST_ID.textArea);
    // 使用 Latin 初始字体覆盖范围内的文本，避免本用例依赖「子集外字符错误条目」
    // 曾被错误地渲染/命中的旧缺陷；本例只验证可渲染文本的删除和 undo/redo 生命周期。
    await editor.fill('delete-ready-text');
    await page.getByTestId(TEST_ID.textDone).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    await selectTool(page, 'lasso');
    await dragPath(page, SELECTION_LASSO_PATH);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();

    const editButton = page.locator('[data-testid^="editor-candidate-text-edit-"]');
    await expect(editButton).toHaveCount(1);
    await editButton.click();
    await editor.fill('');
    await page.getByTestId(TEST_ID.textDone).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 2, 0);
    await expectSelectionCleared(page);

    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 1);
    await expectSelectionCleared(page);

    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 2, 0);
    await expectSelectionCleared(page);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 候选选框（Web-only）的独立 Chromium E2E。
 *
 * 全部通过既有 `openCandidateEditor` 真实同源 CanvasKit 加载，选择生命周期由“pen 绘制 →
 * lasso 闭合选择 1 条”建立，只操作 DOM 暴露的 `selection-frame` / `selection-handle-*` /
 * `selection-rotate-handle`，不访问 React state、不假设任何边中点或 resize selector。
 * 断言的是移动 / 旋转 / 四角等比缩放这组 core 相似变换契约的 history 语义，不含像素/颜色。
 */
test.describe('候选编辑器根路径（/）Chromium Web 候选选框（Web-only）契约', () => {
  test('lasso 选中 1 条后选框与四角等比手柄/旋转手柄可见，工具栏不再声称未接入', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    // 选框与旋转手柄可见，且旋转手柄语义正确。
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.selectionRotateHandle)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.selectionRotateHandle)).toHaveAttribute(
      'title',
      '旋转选中对象'
    );

    // 恰有四个角手柄；每个都声明为等比缩放，没有边中点 / resize 手柄。
    const cornerHandles = page.locator(`[data-testid^="${TEST_ID.selectionHandlePrefix}"]`);
    await expect(cornerHandles).toHaveCount(4);
    for (const cornerId of SELECTION_CORNER_HANDLE_IDS) {
      const handle = page.getByTestId(cornerId);
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute('title', /角等比缩放选中对象/);
    }

    // 工具栏如实描述已接入的四角等比能力，不再声称“未接入”。
    await expect(page.getByTestId(TEST_ID.selectionTransform)).not.toContainText('未接入');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('拖动选框 body 移动：活动预览不写 history，up 仅 +1，undo 清理选择与 history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    const frame = await boxOfTestId(page, TEST_ID.selectionFrame);
    const start = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 30, { steps: 8 });
    // 活动预览期间：preview 存在，但 document / history 仍是提交前快照。
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toBeVisible();
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await page.mouse.up();

    // 松开后恰好提交一条 history；对象数不变、targets 保留，但活动预览必须清理。
    await expectHistory(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toHaveCount(0);

    // undo 回退这一条移动，同时清理选择生命周期（不作像素断言）。
    await page.getByTestId(TEST_ID.undo).click();
    await expectHistory(page, 1, 1);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectSelectionCleared(page);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('拖动一角等比手柄：活动预览期间 history 仍为 1，up 后恰 +1', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    // 只使用真实 DOM 角手柄位置，不假设任何边中点 / resize selector。
    const corner = await centerOfTestId(page, SELECTION_CORNER_HANDLE_IDS[0]);

    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    // 沿对角线向外拖拽（top-left 相对 bottom-right 锚点放大）。
    await page.mouse.move(corner.x - 40, corner.y - 30, { steps: 8 });
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toBeVisible();
    await expectHistory(page, 1, 0);
    await page.mouse.up();

    // 松开后只新增一条 history；对象数不变，仍是四角等比手柄。
    await expectHistory(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expect(page.locator(`[data-testid^="${TEST_ID.selectionHandlePrefix}"]`)).toHaveCount(4);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('拖动旋转手柄：活动预览期间 history 仍为 1，up 后恰 +1', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    const rotate = await centerOfTestId(page, TEST_ID.selectionRotateHandle);
    await page.mouse.move(rotate.x, rotate.y);
    await page.mouse.down();
    await page.mouse.move(rotate.x + 60, rotate.y + 40, { steps: 12 });
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toBeVisible();
    await expectHistory(page, 1, 0);
    await page.mouse.up();

    await expectHistory(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('活动选择变换中 pointercancel：预览清除、document 与 history 零写入', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    const rotate = await centerOfTestId(page, TEST_ID.selectionRotateHandle);
    await page.mouse.move(rotate.x, rotate.y);
    await page.mouse.down();
    await page.mouse.move(rotate.x + 50, rotate.y + 30, { steps: 8 });
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toBeVisible();
    await expectHistory(page, 1, 0);

    // 派发真实 DOM pointercancel（Chromium 鼠标主指针 pointerId 恒为 1），走 adapter 的 cancel
    // 生命周期，并由产品状态文本确认“已取消”；这不是用“无移动”冒充 cancel。
    await page.evaluate(() => {
      document.querySelector('[data-testid="editor-candidate-canvas"]')?.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: 1,
          pointerType: 'mouse',
          bubbles: true,
          cancelable: true,
        })
      );
    });

    await expect(page.getByTestId(TEST_ID.selectionPreview)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.status)).toContainText('选框变换已取消');
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    // 随后真实 mouse up 不应再产生任何提交（该 pointer 已被取消）。
    await page.mouse.up();
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('选框手柄按下/抬起无移动为 noop：零 history、选择与对象数不变', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    const rotate = await centerOfTestId(page, TEST_ID.selectionRotateHandle);
    await page.mouse.move(rotate.x, rotate.y);
    await page.mouse.down();
    // down 的 identity intent 不产生活动预览，也不写 history。
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toHaveCount(0);
    await page.mouse.up();

    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('平移模式与 Space 不夺取活动 selection transform 手势', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);
    await selectSinglePenStrokeWithLasso(page);

    // 打开平移模式：若所有权判断有误，随后按下选框会被当作平移而改视口。
    await page.getByTestId(TEST_ID.panToggle).click();
    await expect(page.getByTestId(TEST_ID.panToggle)).toHaveText('退出平移');
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    const frame = await boxOfTestId(page, TEST_ID.selectionFrame);
    const start = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // 手势进行中再按住 Space，双重确认导航不会中途夺取所有权。
    await page.keyboard.down('Space');
    await page.mouse.move(start.x + 50, start.y + 20, { steps: 8 });
    await expect(page.getByTestId(TEST_ID.selectionPreview)).toBeVisible();
    await expectHistory(page, 1, 0);
    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Space');

    // 松开后 selection transform 提交一次；视口始终未被平移。
    await expectHistory(page, 2, 0);
    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 候选尺子（Web-only）的独立 Chromium E2E。
 *
 * 产品已把尺子接入 core：Ctrl / Command + 鼠标在尺子上平移，Alt + 鼠标旋转；无修饰键的
 * mouse / pen 会把命中交还 paper 工具；ruler 手势由 Web adapter 统一清理，且永不写入
 * document / history / viewport。
 *
 * 证据强度与局限：
 *  - 只用 DOM 语义（testID / title / 文本 / 内联 style 变化 + document / history / viewport
 *    计数）断言，不做像素/颜色/截图比对；
 *  - 位置没有公开文本，按任务约定只对比尺子背景层内联 style 的“变化”，不解读具体坐标；
 *  - 旋转用公开的 `editor-candidate-ruler-rotation` 文本断言；
 *  - 触摸 / 多指刚体手势依赖合成 PointerEvent，在 Chromium Web 不稳定，本文件不做伪设备断言，
 *    因此**不覆盖** native、真实多触、像素或性能，也不代表 OpenSpec 任务 7.4 完成；
 *  - 每个用例独立打开页面准备数据，不依赖同文件其它用例的执行顺序。
 */
test.describe('候选编辑器根路径（/）Chromium Web 候选尺子（Web-only）契约', () => {
  test('候选尺子可见、状态如实标注 core 已接入、初始旋转为 0 deg', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 尺子容器、背景层与旋转读数都可见；状态如实标注 core 手势已接入。
    await expect(page.getByTestId(TEST_ID.ruler)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.rulerBackground)).toBeVisible();
    await expect(page.getByTestId(TEST_ID.rulerBackground)).toHaveAttribute(
      'title',
      /Ctrl 或 Command/
    );
    await expect(page.getByTestId(TEST_ID.rulerStatus)).toHaveText('尺子：core 手势已接入');
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    // 尺子挂载本身不改变 document / history。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('Ctrl 拖动尺子背景：位置 observable 变化、旋转保持 0、document/history/viewport 不变', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    const before = await readRulerStyle(page);
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    await page.keyboard.down(RULER_PRIMARY_MODIFIER);
    // 从尺子中心线右侧按下，确保命中背景层且不落在旋转 pivot 上。
    await page.mouse.move(center.x + 120, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 260, center.y + 60, { steps: 10 });
    // 活动期间：提示进入平移预览，document / history 仍是提交前快照。
    await expect(page.getByTestId(TEST_ID.status)).toContainText('尺子平移预览中');
    await expectHistory(page, 0, 0);
    await page.mouse.up();
    await page.keyboard.up(RULER_PRIMARY_MODIFIER);

    // 位置发生 observable 变化（只验证“变化”，不解读坐标），旋转保持 0。
    const after = await readRulerStyle(page);
    expect(after.left).not.toBe(before.left);
    expect(after.top).not.toBe(before.top);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    // ruler 不写 document / history，也不改动 viewport。
    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('Alt 拖动尺子背景：旋转文本 observable 变化、document/history/viewport 不变', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    const before = await readRulerStyle(page);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    await page.keyboard.down('Alt');
    await page.mouse.move(center.x + 120, center.y);
    await page.mouse.down();
    // 绕尺子中线裁切段中点旋转：从 +x 方向拖到 +y 方向，约 90°，命中 45° 吸附。
    await page.mouse.move(center.x, center.y + 120, { steps: 12 });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('尺子旋转预览中');
    await expectHistory(page, 0, 0);
    await page.mouse.up();
    await page.keyboard.up('Alt');

    // 旋转读数变化到 90 deg；背景 transform 也随之变化。
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('90 deg');
    const after = await readRulerStyle(page);
    expect(after.transform).not.toBe(before.transform);

    await expect(page.getByText('视口 0, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('无修饰键在尺子上拖动：rotation 不变且 paper 工具正常提交一笔', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 140, center.y + 80, { steps: 10 });
    await page.mouse.up();

    // 尺子视觉状态未变化；匹配的 paper 工具（默认 Pen）恰好提交一笔。
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('尺子 Ctrl 拖动中派发 pointercancel：提示已取消、零写入，随后普通绘制仍可提交', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    const before = await readRulerStyle(page);

    await page.keyboard.down(RULER_PRIMARY_MODIFIER);
    await page.mouse.move(center.x + 120, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 200, center.y + 40, { steps: 8 });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('尺子平移预览中');
    await expectHistory(page, 0, 0);

    // 派发真实 DOM pointercancel（Chromium 鼠标主指针 pointerId 恒为 1），经 Web adapter 的
    // cancel 生命周期清理；这不是用“无移动”冒充 cancel。
    await page.getByTestId(TEST_ID.rulerBackground).dispatchEvent('pointercancel', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
      cancelable: true,
    });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('尺子手势已取消');

    // 释放真实指针，避免后续绘制被浏览器残留按下状态干扰。
    await page.mouse.up();
    await page.keyboard.up(RULER_PRIMARY_MODIFIER);

    // cancel 只清理不提交：尺子回到拖动前快照，document / history 零写入。
    const after = await readRulerStyle(page);
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 随后普通画布交互仍可开始并提交一笔。
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 候选**生产字体链 + frame** 的 Chromium Web 持久 E2E（本文件新增纵切，Web-only）。
 *
 * 覆盖范围：
 *  - 初始：同源 `/fonts/manifest.json` 与 `/canvaskit.wasm` 正常加载，Latin initial 就绪、
 *    空 shaping ready、正式 frame 已挂载且 unresolved 为 0；
 *  - 四个文本 tier（Latin / CJK / Arabic / emoji）依次触发真实 on-demand 字体资产，断言
 *    `text-assets` 暴露**实际 asset id**、`text-shaping-status` 的 ready 计数与 pending/error；
 *  - 对 CJK / Arabic / emoji 的 production 文本，在 dSF=1/2 下对真实 CanvasKit canvas 截图做
 *    有限局部 PNG readback，只要求非背景的连续深色/有色簇，不断言具体 emoji 色彩或绝对字形；
 *  - 使用既有 textarea 输入接口，并在文字 frame 上通过既有 text 工具命中打开既有文本编辑。
 *
 * 边界声明：
 *  - 本组只覆盖 Chromium Web + 同源真实 CanvasKit，**不**覆盖 native、IME 候选窗、性能基线，
 *    也**不是** OpenSpec 任务 7.4 已完成的证据；本组现从正式根 `/` 打开（根切已完成）。
 *  - 不做逐像素相等、绝对视觉等价、无抗锯齿误差保证或跨 dSF 像素比较。
 *  - **frame 重基（requirement 4）明确未覆盖**：当前 candidate surface 没有暴露 frame origin 的
 *    testID，`frame-status` 只是固定“已挂载”文案，80 DIP 的 pan 不会改变 `frame-diagnostics` 的
 *    visible/renderable 计数，因此没有可观察的“重基”信号；按任务约定不虚构坐标/断言，明确记为
 *    阻碍。
 */

/** frame / 字体链相关稳定 testID */
const FRAME_TEST_ID = {
  frameStatus: 'editor-candidate-frame-status',
  frameDiagnostics: 'editor-candidate-frame-diagnostics',
  frameUnresolved: 'editor-candidate-frame-unresolved',
  textAssets: 'editor-candidate-text-assets',
  textShapingStatus: 'editor-candidate-text-shaping-status',
  frameRetry: 'editor-candidate-frame-retry',
  frameGate: 'editor-candidate-frame-gate',
} as const;

/**
 * 四 tier 的生产文本。`assetId` 是 manifest 中真实 asset id，`anchor` 是稳定的**画布世界坐标**
 * （viewport 恒为 identity 时等于 canvas 局部 CSS DIP）。使用世界坐标而非 host 比例，是因为提交
 * 文本会让“已提交文本”面板出现并改变 host 高度；世界坐标不受该布局回流影响。
 */
const TEXT_TIERS = [
  { id: 'latin', text: 'Hamster Note', assetId: 'latin', anchor: { x: 90, y: 30 } },
  { id: 'cjk', text: '世界', assetId: 'cjk-on-demand', anchor: { x: 90, y: 120 } },
  {
    id: 'arabic',
    text: 'مرحبا',
    assetId: 'arabic-on-demand',
    anchor: { x: 90, y: 220 },
  },
  {
    id: 'emoji',
    text: '👨‍👩‍👧‍👦',
    assetId: 'emoji-on-demand',
    anchor: { x: 90, y: 320 },
  },
] as const;

/** 仅包含 CJK / Arabic / emoji 三个 on-demand tier，用于像素与命中覆盖。 */
const ON_DEMAND_TIERS = TEXT_TIERS.filter((tier) => tier.id !== 'latin');

type TextTier = (typeof TEXT_TIERS)[number];

/** 在导航前登记同源 `/fonts/manifest.json` 响应，供初始字体链断言。 */
function waitForFontManifest(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/fonts/manifest.json' && response.status() === 200,
    { timeout: 90_000 }
  );
}

/** 在画布世界坐标处做一次点击；viewport 恒为 identity 时世界坐标即画布局部 CSS DIP。 */
async function clickCanvasWorld(
  page: Page,
  world: Readonly<{ x: number; y: number }>
): Promise<void> {
  const box = await canvasBox(page);
  // host 有 1px 边框：局部 screen = client - rect.left - clientLeft，故这里显式加回 clientLeft。
  await page.mouse.move(box.x + 1 + world.x, box.y + 1 + world.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** 通过既有 textarea 接口在画布世界坐标处提交一条文本（不依赖系统 IME）。 */
async function commitTextAt(page: Page, tier: TextTier): Promise<void> {
  await selectTool(page, 'text');
  await clickCanvasWorld(page, tier.anchor);
  const editor = page.getByTestId(TEST_ID.textArea);
  await expect(editor).toBeVisible();
  // 使用产品既有 textarea 输入路径；不派发系统 IME 组合事件。
  await editor.fill(tier.text);
  await expect(editor).toHaveValue(tier.text);
  await page.getByTestId(TEST_ID.textDone).click();
  await expect(editor).toHaveCount(0);
}

/** 在画布世界坐标基础上再偏移固定 DIP 后点击；用于命中文本内部而非恰好落在角点。 */
async function clickCanvasWorldOffset(
  page: Page,
  world: Readonly<{ x: number; y: number }>,
  dx: number,
  dy: number
): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 1 + world.x + dx, box.y + 1 + world.y + dy);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * 等待字体资产与文本 shaping 到达 ready，并断言实际 asset id 与 shaping 计数。
 * `assetIds` 为当前 document 应注册的全部生产字体 id。
 */
async function expectTextChainReady(
  page: Page,
  expected: Readonly<{ assetIds: readonly string[]; readyCount: number }>
): Promise<void> {
  const assets = page.getByTestId(FRAME_TEST_ID.textAssets);
  await expect(assets).toContainText('已注册生产字体', { timeout: 30_000 });
  for (const assetId of expected.assetIds) {
    await expect(assets).toContainText(assetId);
  }
  const shaping = page.getByTestId(FRAME_TEST_ID.textShapingStatus);
  await expect(shaping).toContainText('shaping ready', { timeout: 30_000 });
  await expect(shaping).toContainText('pending 0');
  await expect(shaping).toContainText('error 0');
  await expect(shaping).toContainText(`ready ${expected.readyCount}`);
  // provider/frame 会原子更新；Canvas 本身保持挂载，避免把单条文本 pending 放大为 renderer 生命周期。
  await expect(page.getByTestId(FRAME_TEST_ID.frameStatus)).toContainText('已挂载', {
    timeout: 30_000,
  });
  await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible();
}

/* ------------------------------------------------------------------------------------------------
 * 以下 PNG readback helper 与既有 error/wasm helper 同源，均为 Web CanvasKit 的有限像素信号：
 * 只解码 Playwright screenshot 的标准 8-bit 非隔行 RGB/RGBA PNG，不做像素相等或视觉等价声明。
 * ---------------------------------------------------------------------------------------------- */

interface RgbaPng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface CanvasScreenshotReadback extends RgbaPng {
  cssWidth: number;
  cssHeight: number;
  pixelsPerCssX: number;
  pixelsPerCssY: number;
  pixelAreaPerCssPixel: number;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const LOCAL_OPAQUE_ALPHA = 224;
const TEXT_TIER_MINIMUM_CLUSTER_CSS_PIXELS = 10;
const EMOJI_MINIMUM_CLUSTER_CSS_PIXELS = 6;

/** 将 #RRGGBB 转 RGB，避免像素断言散落魔法数字。 */
function rgb(hex: string): RgbColor {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/** PNG scanline 的 Paeth 预测器（Playwright screenshot 标准 PNG）。 */
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

/**
 * 解码 Playwright screenshot 的 8-bit、非隔行 RGB/RGBA PNG；其它格式显式失败，绝不把无法
 * readback 的 canvas 静默当作已验证。
 */
async function decodeRgbaPng(png: Uint8Array): Promise<RgbaPng> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hasPngSignature = signature.every((byte, index) => png[index] === byte);
  if (png.length < signature.length || !hasPngSignature) {
    throw new Error('候选 canvas readback 失败：screenshot 未返回 PNG 数据。');
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
      throw new Error('候选 canvas readback 失败：PNG chunk 长度损坏。');
    }
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length !== 13) {
        throw new Error('候选 canvas readback 失败：PNG IHDR 长度无效。');
      }
      width = readUint32BigEndian(data, 0);
      height = readUint32BigEndian(data, 4);
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
      '候选 canvas readback 失败：需要 8-bit、非隔行 RGB/RGBA PNG，或截图中没有可解码的像素数据。'
    );
  }

  let inflated: Uint8Array;
  try {
    // 依赖名由变量提供，令本仓库在未配置 @types/node 时仍可用运行时 Node 标准 zlib。
    const zlibModuleName = 'node:zlib';
    const zlib = (await import(zlibModuleName)) as {
      inflateSync(compressed: Uint8Array): Uint8Array;
    };
    inflated = zlib.inflateSync(concatBytes(imageData));
  } catch (error) {
    throw new Error(
      `候选 canvas readback 失败：PNG IDAT 无法解压：${error instanceof Error ? error.message : String(error)}`
    );
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  if (inflated.length !== height * (stride + 1)) {
    throw new Error('候选 canvas readback 失败：PNG scanline 尺寸与 IHDR 不一致。');
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
          throw new Error(`候选 canvas readback 失败：不支持 PNG filter type ${filter}。`);
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

/**
 * 读取真实 CanvasKit canvas 的 locator screenshot，并以 canvas CSS box 归一化尺寸与簇阈值。
 * 这是跨 dSF 的有限 readback 信号，不作完整裁剪或绝对视觉等价声明。
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
      `dSF=${deviceScaleFactor} 候选 canvas readback 失败：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const image = await decodeRgbaPng(screenshot);
  const cssBox = await canvas.boundingBox();
  if (!cssBox || cssBox.width <= 0 || cssBox.height <= 0) {
    throw new Error(`dSF=${deviceScaleFactor} 候选 canvas readback 失败：canvas CSS box 不可用。`);
  }
  const pixelsPerCssX = image.width / cssBox.width;
  const pixelsPerCssY = image.height / cssBox.height;
  expect(Math.abs(pixelsPerCssX - deviceScaleFactor)).toBeLessThan(0.02);
  expect(Math.abs(pixelsPerCssY - deviceScaleFactor)).toBeLessThan(0.02);
  return {
    ...image,
    cssWidth: cssBox.width,
    cssHeight: cssBox.height,
    pixelsPerCssX,
    pixelsPerCssY,
    pixelAreaPerCssPixel: pixelsPerCssX * pixelsPerCssY,
  };
}

/**
 * 统计目标色附近最大的 8 邻接像素簇；阈值容纳 canvas 抗锯齿与 screenshot 色彩舍入，但仍要求
 * 存在连续的非背景信号，而不是单个偶然色点。
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
 * 依 canvas CSS box 将目标区域裁为局部 PNG，避免把 DOM 图例或画布其他场景的像素混入断言。
 * 截图坐标按当前 dSF 归一化，不进行跨 dSF 逐像素比较。
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
    throw new Error(`候选 canvas 局部 readback 失败：${label} 的 CSS 区域无效。`);
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
      `候选 canvas 局部 readback 失败：${label} 的 CSS 区域 (${region.x}, ${region.y}, ${region.width}, ${region.height}) 超出 canvas ${screenshot.cssWidth.toFixed(1)}×${screenshot.cssHeight.toFixed(1)}。`
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
 * emoji fallback 可能是单色轮廓或彩色 glyph。先把有色或深色像素归一为黑色，再复用色簇 helper
 * 统计连续簇；不假定 emoji 的具体字体、颜色或图案。
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

/** 依据实际 canvas CSS 尺寸，把某个 tier 的世界落点换算为局部采样区域。 */
function tierSampleRegion(
  screenshot: CanvasScreenshotReadback,
  tier: TextTier
): Readonly<{ x: number; y: number; width: number; height: number }> {
  // 文本自落点向右下排版；留 margin 并把区域限制在 canvas 内，避免溢出。
  const desired = {
    x: tier.anchor.x + 2,
    y: tier.anchor.y + 2,
    width: 120,
    height: 34,
  };
  const width = Math.min(desired.width, Math.max(1, screenshot.cssWidth - desired.x - 2));
  const height = Math.min(desired.height, Math.max(1, screenshot.cssHeight - desired.y - 2));
  return { x: desired.x, y: desired.y, width, height };
}

/**
 * 在独立 dSF context 中采集候选字体链的真实 CanvasKit 状态、局部 screenshot 色簇与文字 frame 命中。
 * 只观察本次 Web CanvasKit 的有限 readback，不是 native 验证、绝对字形正确性结论，也不要求跨
 * dSF 逐像素等价。
 */
async function verifyCandidateTextTiersAtDeviceScaleFactor(
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
    await openCandidateEditor(page);

    // 逐一提交三个 on-demand tier；每次提交都会触发真实字体资产下载与 provider 重建。
    for (const [index, tier] of ON_DEMAND_TIERS.entries()) {
      await commitTextAt(page, tier);
      await expect(page.getByTestId(TEST_ID.count)).toContainText(`笔迹 ${index + 1}`);
      await expectTextChainReady(page, {
        assetIds: ON_DEMAND_TIERS.slice(0, index + 1).map((candidate) => candidate.assetId),
        readyCount: index + 1,
      });
    }

    const canvas = page.getByTestId(TEST_ID.canvas);
    await expect(canvas).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);
    const screenshot = await readCanvasScreenshot(canvas, deviceScaleFactor);

    // 只要求每个 tier 落点附近存在连续的非背景深色/有色簇，不解读具体 emoji 色彩或绝对字形。
    for (const tier of ON_DEMAND_TIERS) {
      const region = tierSampleRegion(screenshot, tier);
      const localImage = readCanvasCssRegion(screenshot, region, `${tier.id} 文本区域`);
      const minimumClusterPixels =
        (tier.id === 'emoji'
          ? EMOJI_MINIMUM_CLUSTER_CSS_PIXELS
          : TEXT_TIER_MINIMUM_CLUSTER_CSS_PIXELS) * screenshot.pixelAreaPerCssPixel;
      expect(
        largestDarkOrColoredCluster(localImage),
        `dSF=${deviceScaleFactor} ${tier.id} 文本区域 (${region.x.toFixed(1)}, ${region.y.toFixed(1)}, ${region.width.toFixed(1)}×${region.height.toFixed(1)}) 未读到足量连续深色/有色非背景簇`
      ).toBeGreaterThanOrEqual(minimumClusterPixels);
    }

    // 既有 text 工具走真实 hitTestDrawingFrame：点击已提交 CJK 文本内部应打开既有编辑并回填原文。
    const cjkTier = TEXT_TIERS.find((tier) => tier.id === 'cjk')!;
    await selectTool(page, 'text');
    await clickCanvasWorldOffset(page, cjkTier.anchor, 28, 12);
    const editor = page.getByTestId(TEST_ID.textArea);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(cjkTier.text);
    await page.getByTestId(TEST_ID.textCancel).click();
    await expect(editor).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe('候选编辑器根路径（/）Chromium Web 生产字体链与 frame（Web-only）契约', () => {
  test('初始：同源 manifest + Latin initial + wasm，frame 挂载、unresolved 0、空 shaping ready', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    const manifestResponse = waitForFontManifest(page);
    const wasmResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/canvaskit.wasm' && response.status() === 200,
      { timeout: 90_000 }
    );

    await openCandidateEditor(page);

    // 同源 /fonts/manifest.json：路径、origin 与 JSON 内容类型。
    const manifest = await manifestResponse;
    expect(new URL(manifest.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(manifest.url()).pathname).toBe('/fonts/manifest.json');
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()['content-type'] ?? '').toContain('json');

    // 同源真实 CanvasKit：200 + application/wasm。
    const wasm = await wasmResponse;
    expect(new URL(wasm.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(wasm.url()).pathname).toBe('/canvaskit.wasm');
    expect(wasm.status()).toBe(200);
    expect(wasm.headers()['content-type'] ?? '').toContain('application/wasm');

    // 正式 frame 已挂载，诊断明确为 ready 且零可见/零可渲染，未解决裁剪为 0。
    await expect(page.getByTestId(FRAME_TEST_ID.frameStatus)).toContainText('正式 frame 已挂载');
    await expect(page.getByTestId(FRAME_TEST_ID.frameDiagnostics)).toHaveText(
      'Frame ready · visible 0 · renderable 0'
    );
    await expect(page.getByTestId(FRAME_TEST_ID.frameUnresolved)).toHaveText('未解决裁剪 0');
    await expect(page.getByTestId(FRAME_TEST_ID.frameRetry)).toHaveCount(0);

    // 初始只注册 Latin initial，绝不预加载 on-demand tier。
    const assets = page.getByTestId(FRAME_TEST_ID.textAssets);
    await expect(assets).toContainText('已注册生产字体');
    await expect(assets).toContainText('latin');
    await expect(assets).not.toContainText('on-demand');

    // 无文本请求时空 shaping 直接 ready：ready/pending/error 全为 0。
    await expect(page.getByTestId(FRAME_TEST_ID.textShapingStatus)).toHaveText(
      'shaping ready · ready 0 · pending 0 · error 0'
    );

    // Canvas 唯一，且未停留在 route loading / error。
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId(TEST_ID.routeLoading)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('四 tier 文本链：Latin/CJK/Arabic/emoji 依次触发真实 asset id 与 shaping ready 计数', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    for (const [index, tier] of TEXT_TIERS.entries()) {
      await commitTextAt(page, tier);
      await expect(page.getByTestId(TEST_ID.count)).toContainText(`笔迹 ${index + 1}`);
      await expectHistory(page, index + 1, 0);
      // text-assets 必须暴露累计的**实际 asset id**；shaping ready 计数等于可见文本请求数。
      await expectTextChainReady(page, {
        assetIds: TEXT_TIERS.slice(0, index + 1).map((candidate) => candidate.assetId),
        readyCount: index + 1,
      });
      await expect(page.getByTestId(FRAME_TEST_ID.frameDiagnostics)).toContainText('Frame ready');
      await expect(page.getByTestId(FRAME_TEST_ID.frameUnresolved)).toHaveText('未解决裁剪 0');
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('dSF=1/2：CJK/Arabic/emoji production 文本的有限 canvas 像素簇与文字 frame 命中', async () => {
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    });
    try {
      for (const deviceScaleFactor of [1, 2]) {
        await verifyCandidateTextTiersAtDeviceScaleFactor(browser, deviceScaleFactor);
      }
    } finally {
      await browser.close();
    }
  });
});

/**
 * 候选**导航（host wheel focal zoom / 轨迹板平移 / 双触 paper navigation）与尺边**的独立
 * Chromium Web E2E（本文件新增纵切，Web-only）。
 *
 * 覆盖范围：
 *  - host `wheel` 监听：Ctrl/Command + 滚轮在指针焦点处缩放，出现 `zoom-feedback` 浮层，
 *    document / history 完全不变，浮层由产品自身超时清理；
 *  - 无修饰键横向滚轮与 Shift + 纵向滚轮走轨迹板平移，改变 tx/ty 而 scale 不变，且不出现缩放
 *    反馈；同一宿主上 Ctrl 滚轮被明确分流为缩放；
 *  - 真实 `PointerEvent`（`pointerType: 'touch'`、显式数值 `pointerId`）：paper 固定双触 pair
 *    navigation 只改 viewport、零 history，第三指不替换固定 pair，pair 结束与单指 cancel 后
 *    普通 paper pen 仍可提交；
 *  - 尺边：无修饰键 mouse / pen 在尺子命中开始绘制时仍路由回 paper 工具并只提交一次 stroke；
 *  - Alt 旋转尺子期间出现 `ruler-angle-feedback` 浮层，document / history / viewport 不变。
 *
 * evidence 强度与局限（如实声明，不虚构）：
 *  - 仅覆盖 Chromium Web + 同源真实 CanvasKit；不是 native 行为、真实触摸设备、像素 / 截图 /
 *    颜色比对或性能基线，也不代表 OpenSpec 任务 7.4 完成；
 *  - Chromium 无法经 Playwright 稳定 API 产生多指触摸序列，因此双指 / 第三指 / cancel 使用
 *    真实 DOM `PointerEvent`（带 actual `pointerType: 'touch'` 与数值 `pointerId`）注入宿主，
 *    断言的是 core 契约与可观察 DOM 文本 / 计数，不伪造设备或像素；
 *  - 尺边吸附、绘制轨迹与 `transient` 几何**没有** DOM testID / 文本 / point debug 暴露，
 *    因此本组**不**断言任何尺边吸附或轨迹像素，只断言“仍提交一次且未改变尺子旋转 / 计数”；
 *  - 每个用例独立打开页面准备数据，不依赖同文件其它用例执行顺序。
 */

/** 组件只用 `Math.round` 输出百分比与整数平移；用锚定正则读取以免误匹配其它百分比文本。 */
const SCALE_LABEL = /^缩放 \d+%$/;
const VIEWPORT_LABEL = /^视口 -?\d+, -?\d+$/;

/** 读取某个无 testID 的只读 metric 文本（缩放 / 视口），不可见时直接失败而非猜测。 */
async function readMetricLabel(page: Page, pattern: RegExp): Promise<string> {
  const label = page.getByText(pattern);
  await expect(label).toBeVisible();
  return (await label.textContent()) ?? '';
}

/** host wheel 的显式修饰键；产品据 ctrl/meta 区分焦点缩放、据 shift/deltaX 区分轨迹板平移。 */
type HostWheelModifiers = Readonly<{ ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }>;

/**
 * 在宿主真实 `wheel` 监听上注入 DOM `WheelEvent`：显式设置 deltaX/deltaY 与修饰键，
 * 覆盖“Ctrl 焦点缩放”与“无修饰 / Shift 轨迹板平移”的分流。坐标按宿主 rect 归一化。
 */
async function dispatchHostWheel(
  page: Page,
  at: CanvasFraction,
  delta: Readonly<{ x: number; y: number }>,
  modifiers: HostWheelModifiers = {}
): Promise<void> {
  await page.evaluate(
    (payload) => {
      const host = document.querySelector('[data-testid="editor-candidate-canvas"]');
      if (!host) throw new Error('找不到 editor-candidate-canvas');
      const rect = host.getBoundingClientRect();
      host.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: payload.deltaX,
          deltaY: payload.deltaY,
          ctrlKey: payload.ctrlKey,
          metaKey: payload.metaKey,
          shiftKey: payload.shiftKey,
          clientX: rect.left + rect.width * payload.fx,
          clientY: rect.top + rect.height * payload.fy,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    {
      fx: at.fx,
      fy: at.fy,
      deltaX: delta.x,
      deltaY: delta.y,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
    }
  );
}

type DispatchPointerType = 'mouse' | 'pen' | 'touch';
type DispatchPointerPhase = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/**
 * 向宿主注入单个真实 DOM `PointerEvent`。`pointerType` 与 `pointerId` 均显式提供，
 * 用于 Chromium 无法经 Playwright 稳定派发的 pen / touch 生命周期（含多指与 cancel）。
 */
async function dispatchHostPointer(
  page: Page,
  phase: DispatchPointerPhase,
  pointer: Readonly<{ pointerId: number; pointerType: DispatchPointerType; at: CanvasFraction }>
): Promise<void> {
  const terminal = phase === 'pointerup' || phase === 'pointercancel';
  await page.evaluate(
    (payload) => {
      const host = document.querySelector('[data-testid="editor-candidate-canvas"]');
      if (!host) throw new Error('找不到 editor-candidate-canvas');
      const rect = host.getBoundingClientRect();
      host.dispatchEvent(
        new PointerEvent(payload.phase, {
          pointerId: payload.pointerId,
          pointerType: payload.pointerType,
          isPrimary: false,
          clientX: rect.left + rect.width * payload.fx,
          clientY: rect.top + rect.height * payload.fy,
          button: 0,
          buttons: payload.terminal ? 0 : 1,
          pressure: payload.terminal ? 0 : 0.5,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    {
      phase,
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      fx: pointer.at.fx,
      fy: pointer.at.fy,
      terminal,
    }
  );
}

/** 用真实 pen `PointerEvent` 在宿主内做一次 down → 多步 move → up 拖拽。 */
async function dispatchPenDrag(
  page: Page,
  from: CanvasFraction,
  to: CanvasFraction,
  pointerId = 41,
  steps = 8
): Promise<void> {
  await dispatchHostPointer(page, 'pointerdown', { pointerId, pointerType: 'pen', at: from });
  for (let step = 1; step <= steps; step += 1) {
    await dispatchHostPointer(page, 'pointermove', {
      pointerId,
      pointerType: 'pen',
      at: {
        fx: from.fx + ((to.fx - from.fx) * step) / steps,
        fy: from.fy + ((to.fy - from.fy) * step) / steps,
      },
    });
  }
  await dispatchHostPointer(page, 'pointerup', { pointerId, pointerType: 'pen', at: to });
}

test.describe('候选编辑器根路径（/）Chromium Web 候选导航与尺边（Web-only）契约', () => {
  test('Ctrl wheel 焦点缩放：scale 与 zoom feedback 改变、history/document 不变、反馈自动消失', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    const scaleBefore = await readMetricLabel(page, SCALE_LABEL);
    const viewportBefore = await readMetricLabel(page, VIEWPORT_LABEL);
    expect(scaleBefore).toBe('缩放 100%');

    // 宿主中心注入 Ctrl + 上滚（deltaY 为负 → 放大），走焦点缩放分支。
    await dispatchHostWheel(page, { fx: 0.5, fy: 0.5 }, { x: 0, y: -240 }, { ctrlKey: true });

    const feedback = page.getByTestId(TEST_ID.zoomFeedback);
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveText(/^\d+%$/);

    const scaleAfter = await readMetricLabel(page, SCALE_LABEL);
    const viewportAfter = await readMetricLabel(page, VIEWPORT_LABEL);
    // 焦点缩放同时改变 scale 与平移量（焦点在世界坐标中保持不动）。
    expect(scaleAfter).not.toBe(scaleBefore);
    expect(viewportAfter).not.toBe(viewportBefore);

    // 缩放只改 viewport：document 与 history 完全不变。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 浮层由产品自身 750ms 超时清理；这里等待其消失，而不是用状态兜底掩盖。
    await expect(feedback).toHaveCount(0, { timeout: 5_000 });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('无修饰键横向 / Shift wheel 轨迹板平移与 Ctrl wheel 分流：tx/ty 变而 scale 不变', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    expect(await readMetricLabel(page, SCALE_LABEL)).toBe('缩放 100%');
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    // 无修饰键横向滚轮（|deltaX|>0）→ 轨迹板平移；不出现缩放反馈且 scale 不变。
    await dispatchHostWheel(page, { fx: 0.5, fy: 0.5 }, { x: 120, y: 0 });
    await expect(page.getByText('视口 -120, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.zoomFeedback)).toHaveCount(0);
    expect(await readMetricLabel(page, SCALE_LABEL)).toBe('缩放 100%');

    // Shift + 纵向滚轮 → 仍为平移（shift 把 deltaY 折算到 x 轴）；scale 仍不变。
    await dispatchHostWheel(page, { fx: 0.5, fy: 0.5 }, { x: 0, y: 80 }, { shiftKey: true });
    await expect(page.getByText('视口 -200, 0')).toBeVisible();
    await expect(page.getByTestId(TEST_ID.zoomFeedback)).toHaveCount(0);
    expect(await readMetricLabel(page, SCALE_LABEL)).toBe('缩放 100%');

    // 同一宿主上 Ctrl 滚轮被分流为缩放：出现反馈且 scale 改变。
    await dispatchHostWheel(page, { fx: 0.5, fy: 0.5 }, { x: 0, y: -240 }, { ctrlKey: true });
    await expect(page.getByTestId(TEST_ID.zoomFeedback)).toBeVisible();
    expect(await readMetricLabel(page, SCALE_LABEL)).not.toBe('缩放 100%');

    // 全部分流都不写 document / history。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('候选编辑器根路径（/）Chromium Web 真触摸 paper navigation（Web-only）契约', () => {
  test('真实 touch PointerEvent：双触 pair navigation 零 history、第三指不替换、结束/取消后 pen 仍可提交', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    // 选远离尺子条带（宿主本地 y≈230）的下方 paper 区域，确保几何命中为 paper。
    const firstTouch: CanvasFraction = { fx: 0.35, fy: 0.78 };
    const secondTouch: CanvasFraction = { fx: 0.65, fy: 0.84 };
    const thirdTouch: CanvasFraction = { fx: 0.5, fy: 0.72 };

    // 首指：默认 pen 在 paper 上只建立本地候选，不写 history。
    await dispatchHostPointer(page, 'pointerdown', {
      pointerId: 101,
      pointerType: 'touch',
      at: firstTouch,
    });
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 第二指抵达：产品丢弃单指候选并改由 core 固定双触 pair 导航。
    await dispatchHostPointer(page, 'pointerdown', {
      pointerId: 102,
      pointerType: 'touch',
      at: secondTouch,
    });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('纸面双触导航预览中');
    await expectHistory(page, 0, 0);

    const viewportBeforePairMove = await readMetricLabel(page, VIEWPORT_LABEL);
    await dispatchHostPointer(page, 'pointermove', {
      pointerId: 101,
      pointerType: 'touch',
      at: { fx: 0.42, fy: 0.8 },
    });
    await dispatchHostPointer(page, 'pointermove', {
      pointerId: 102,
      pointerType: 'touch',
      at: { fx: 0.74, fy: 0.88 },
    });
    const viewportAfterPairMove = await readMetricLabel(page, VIEWPORT_LABEL);
    // pair 导航确实改变了 viewport，但 document / history 保持为零。
    expect(viewportAfterPairMove).not.toBe(viewportBeforePairMove);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 第三指：既不替换固定 pair，也不改变 viewport / document / history。
    await dispatchHostPointer(page, 'pointerdown', {
      pointerId: 103,
      pointerType: 'touch',
      at: thirdTouch,
    });
    await dispatchHostPointer(page, 'pointermove', {
      pointerId: 103,
      pointerType: 'touch',
      at: { fx: 0.5, fy: 0.3 },
    });
    expect(await readMetricLabel(page, VIEWPORT_LABEL)).toBe(viewportAfterPairMove);
    await expect(page.getByTestId(TEST_ID.status)).toContainText('纸面双触导航预览中');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 依次抬起固定 pair：导航结束提示、仍零 history。
    await dispatchHostPointer(page, 'pointerup', {
      pointerId: 101,
      pointerType: 'touch',
      at: { fx: 0.42, fy: 0.8 },
    });
    await dispatchHostPointer(page, 'pointerup', {
      pointerId: 102,
      pointerType: 'touch',
      at: { fx: 0.74, fy: 0.88 },
    });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('纸面双触导航已结束');
    await expectHistory(page, 0, 0);
    // 清理被忽略的第三指，避免残留 owner 干扰后续普通绘制。
    await dispatchHostPointer(page, 'pointerup', {
      pointerId: 103,
      pointerType: 'touch',
      at: { fx: 0.5, fy: 0.3 },
    });

    // 单指 touch 取消：本地候选被丢弃、零写入。
    await dispatchHostPointer(page, 'pointerdown', {
      pointerId: 104,
      pointerType: 'touch',
      at: { fx: 0.45, fy: 0.8 },
    });
    await dispatchHostPointer(page, 'pointercancel', {
      pointerId: 104,
      pointerType: 'touch',
      at: { fx: 0.45, fy: 0.8 },
    });
    await expect(page.getByTestId(TEST_ID.status)).toContainText('指针已取消');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    // 触摸会话清理后，普通 mouse paper pen 仍可提交一笔。
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('候选编辑器根路径（/）Chromium Web 尺边与 Alt 尺子反馈（Web-only）契约', () => {
  test('尺边：无修饰键 mouse/pen 在尺子上开始绘制仍提交一次 paper stroke，rotation 不变', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    const box = await canvasBox(page);
    const rulerCenterFraction: CanvasFraction = {
      fx: (center.x - box.x) / box.width,
      fy: (center.y - box.y) / box.height,
    };
    // 从尺身中心向外拖拽：起点几何落在尺子条带内，但无修饰键 pen 必须被路由回 paper 工具。
    const penEnd: CanvasFraction = {
      fx: Math.min(0.9, rulerCenterFraction.fx + 0.25),
      fy: Math.min(0.95, rulerCenterFraction.fy + 0.2),
    };

    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    await dispatchPenDrag(page, rulerCenterFraction, penEnd);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.status)).toContainText('Pen已提交一次');
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    // 鼠标从尺子外侧开始、穿过尺身：路径进入限制条带仍只提交一次，且不改旋转。
    // 注意：尺边吸附后的几何没有 DOM / point debug 暴露，本用例不声称任何吸附效果。
    const aboveRuler: CanvasFraction = {
      fx: rulerCenterFraction.fx,
      fy: (center.y - 90 - box.y) / box.height,
    };
    const belowRuler: CanvasFraction = {
      fx: Math.min(0.9, rulerCenterFraction.fx + 0.3),
      fy: (center.y + 90 - box.y) / box.height,
    };
    await dragCanvas(page, aboveRuler, belowRuler, 10);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('Alt 旋转尺子显示 ruler-angle-feedback 浮层且无 history/document/viewport 写入', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    await expect(page.getByTestId(TEST_ID.rulerAngleFeedback)).toHaveCount(0);
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    await page.keyboard.down('Alt');
    await page.mouse.move(center.x + 120, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + 120, { steps: 12 });

    const feedback = page.getByTestId(TEST_ID.rulerAngleFeedback);
    await expect(feedback).toBeVisible();
    // 只断言浮层存在且暴露角度文本，不做像素 / 坐标位置断言。
    await expect(feedback).toHaveText(/^-?\d+ deg$/);
    await expect(page.getByTestId(TEST_ID.status)).toContainText('尺子旋转预览中');

    // 旋转预览期间：document / history / viewport 均不变。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    await expect(page.getByText('视口 0, 0')).toBeVisible();

    await page.mouse.up();
    await page.keyboard.up('Alt');

    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('90 deg');
    await expect(page.getByTestId(TEST_ID.rulerAngleFeedback)).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 候选根切前 P0 的独立 Chromium Web E2E（本文件新增纵切，Web-only）：frame-only 查询、字体
 * 错误隔离、图片资源复用与尺边重入/稀疏跨越。全部复用既有 `openCandidateEditor` 真实同源
 * CanvasKit 路径，只断言稳定 testID / 计数文本 / history / DOM 内联样式，绝不访问 React state。
 *
 * evidence 强度与局限（如实声明，不虚构）：
 *  - 仅覆盖 Chromium Web + 同源真实 CanvasKit；不是 native 行为、真实触摸、像素 / 截图 / 颜色
 *    比对或性能基线，也不代表 OpenSpec 任务 7.4 完成；
 *  - 尺边吸附后的几何、候选点计数与 sparse crossing 的“跳过条带不补造”都**没有** DOM testID /
 *    文本 / point debug 暴露，因此本组只做最窄断言：整段手势恰好提交一次 pen stroke、候选期间
 *    history 不变、尺子旋转不变；不宣称任何吸附坐标或稀疏采样内部行为；
 *  - frame-only 查询的 `blocked` / `frame-unavailable` 分支（frame 为 null）在稳定 Chromium Web
 *    路径不可达：`frameBlocked = !canvasSize || pipeline.error || !frame`，正常挂载后 canvasSize
 *    存在、document 可准备、frame 可创建，没有可稳定触发的失败注入点。因此**不伪造** blocked
 *    断言，只覆盖同样“拒绝后不退回 raw document”的退化套索 frame 模式路径，并在用例内记录该
 *    局限；
 *  - CJK 表意文字都会请求 CJK tier；本组用未包含于当前生产 subset 的 U+5BAB 触发实际
 *    Typeface 缺 glyph 分支，断言该 entry error 而不把浏览器 fallback 视为成功；
 *  - 图片超限（>20 MiB / >8192 边 / >40M 像素）需要真实大文件才能稳定触发，本组不人为构造大
 *    blob 拖慢 CI，改以“无效 MIME 被冻结拒绝”与“同 data URL 复用同一资源记录”覆盖导入边界；
 *  - 每个用例独立打开页面准备数据，不依赖同文件其它用例执行顺序。
 */

/** 根切前 P0 相关稳定 testID（与既有常量并存，避免散落硬编码字符串）。 */
const P0_TEST_ID = {
  frameQueryStatus: 'editor-candidate-frame-query-status',
  textResourceStatus: 'editor-candidate-text-resource-status',
  textEntryStatusPrefix: 'editor-candidate-text-entry-status-',
  textResourceRetry: 'editor-candidate-text-resource-retry',
  imageImportPolicy: 'editor-candidate-image-import-policy',
  imageImportState: 'editor-candidate-image-import-state',
  frameGate: 'editor-candidate-frame-gate',
} as const;

/** 当前生产 CJK subset 之外、且非 U+754C 的确定码点，用于触发 Typeface 缺 glyph 错误隔离。 */
const UNSUPPORTED_CJK_CODE_POINT = 0x5bab;

/** 复用的有效 1×1 PNG 文件描述；同内容 / 同名保证第二次导入命中同一 data URL。 */
const ONE_PIXEL_PNG_FILE = {
  name: 'one-pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
} as const;

/** 在绝对页面坐标上做一次 down → 多点 move → up 的鼠标手势（用于尺边跨条带）。 */
async function dragScreenPath(
  page: Page,
  points: readonly Readonly<{ x: number; y: number }>[],
  steps = 6
): Promise<void> {
  const [first, ...rest] = points;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(point.x, point.y, { steps });
  }
  await page.mouse.up();
}

test.describe('候选编辑器根路径（/）Chromium Web 根切前 P0（Web-only）契约', () => {
  test('frame query：lasso/eraser 均以 frame 模式查询；erase 命中一次恰好一条 history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const queryStatus = page.getByTestId(P0_TEST_ID.frameQueryStatus);
    // 初始终注意义：尚未发生任何 frame 查询。产品实际文案为
    // `Frame query idle · none · revision none · diagnostics none`，此处按稳定语义精确断言。
    await expect(queryStatus).toHaveText(
      'Frame query idle · none · revision none · diagnostics none'
    );

    // 已有候选画笔可见；纯绘制不触发 frame 查询。
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    await expect(queryStatus).toContainText('Frame query idle');

    // 套索：通过 query status 断言确实走 frame 模式，而不是只看 selection 计数。
    await selectTool(page, 'lasso');
    await dragPath(page, SELECTION_LASSO_PATH);
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 1');
    await expect(page.getByTestId(TEST_ID.selectionFrame)).toBeVisible();
    await expect(queryStatus).toContainText('Frame query frame · lasso');
    await expect(queryStatus).not.toContainText('revision none');
    await expect(queryStatus).toContainText('diagnostics none');
    // 套索只更新选择，不写 history。
    await expectHistory(page, 1, 0);

    // 橡皮擦：同一 frame-only 入口，命中后恰好提交一条 history。
    await selectTool(page, 'eraser');
    await dragCanvas(page, { fx: 0.18, fy: 0.2 }, { fx: 0.7, fy: 0.78 });
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expect(queryStatus).toContainText('Frame query frame · eraser');
    await expect(queryStatus).not.toContainText('revision none');
    await expectHistory(page, 2, 0);
    await expectSelectionCleared(page);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('frame query 安全拒绝：退化套索仍走 frame 模式并报告 invalid-lasso-polygon，零 history', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    // 退化的共线套索（零面积）在 frame 查询阶段被拒绝；它必须报告 frame 模式诊断、清零选择，
    // 而不是退回 raw document。这是可在 Web 稳定触发的“拒绝后无 raw fallback”安全场景。
    // 说明：真正的 blocked / frame-unavailable（帧为 null）在稳定 Chromium Web 路径不可触发，
    // 本文件不伪造该分支，仅记录局限。
    await selectTool(page, 'lasso');
    await dragCanvas(page, { fx: 0.2, fy: 0.3 }, { fx: 0.75, fy: 0.3 });
    const queryStatus = page.getByTestId(P0_TEST_ID.frameQueryStatus);
    await expect(queryStatus).toContainText('Frame query frame · lasso');
    await expect(queryStatus).toContainText('invalid-lasso-polygon');
    await expect(page.getByTestId(TEST_ID.selectionCount)).toContainText('选择 0');
    // 拒绝查询不改变 document / history，也没有 raw fallback 删除。
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    // frame 始终 ready（gate 不出现、状态已挂载），确认 blocked 分支不可达。
    await expect(page.getByTestId(P0_TEST_ID.frameGate)).toHaveCount(0);
    await expect(page.getByTestId(FRAME_TEST_ID.frameStatus)).toContainText('已挂载');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('字体错误隔离：CJK tier 缺 glyph 只让该 entry error，不崩 frame、不命中、retry 零写入', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 保持一个既有可见 pen 对象，用于证明其它对象与 canvas 不受字体错误影响。
    await drawMouseStroke(page);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    // 提交一项不在生产 CJK subset 内的字符（U+5BAB）：先加载 CJK tier，再由实际 Typeface
    // glyph 校验拒绝，绝不让浏览器 fallback 冒充 Skia 成功。
    const unsupported = String.fromCodePoint(UNSUPPORTED_CJK_CODE_POINT);
    await selectTool(page, 'text');
    await clickCanvasWorld(page, { x: 90, y: 120 });
    const editor = page.getByTestId(TEST_ID.textArea);
    await expect(editor).toBeVisible();
    await editor.fill(unsupported);
    await expect(editor).toHaveValue(unsupported);
    await page.getByTestId(TEST_ID.textDone).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);

    // 该 entry 在 CJK tier 已加载后进入 error，并暴露真实缺 glyph 信息；资源计数为 error 1。
    const entry = page.getByTestId(`${P0_TEST_ID.textEntryStatusPrefix}0`);
    await expect(entry).toContainText('error', { timeout: 30_000 });
    await expect(entry).toContainText('缺少当前文本所需 glyph');
    await expect(page.getByTestId(P0_TEST_ID.textResourceStatus)).toContainText('error 1');

    // frame 无全局崩溃，canvas 仍在；错误 entry 仍可见但不计入 renderable：精确计数为
    // visible 2（pen + error 文本）/ renderable 1（仅 pen）。这直接证明错误 entry 既无 render
    // 也不会被 hitTest 命中（hitTest 只搜索 renderableEntries），而不是放宽断言掩盖回退。
    await expect(page.getByTestId(FRAME_TEST_ID.frameStatus)).toContainText('已挂载');
    await expect(page.getByTestId(FRAME_TEST_ID.frameDiagnostics)).toHaveText(
      'Frame ready · visible 2 · renderable 1'
    );
    await expect(page.locator('canvas')).toHaveCount(1);

    // 可观察补充：text 工具点击该文本落点只会新建空草稿，而不是打开既有内容。
    await selectTool(page, 'text');
    await clickCanvasWorld(page, { x: 110, y: 132 });
    const newEditor = page.getByTestId(TEST_ID.textArea);
    await expect(newEditor).toBeVisible();
    await expect(newEditor).toHaveValue('');
    await page.getByTestId(TEST_ID.textCancel).click();
    await expect(newEditor).toHaveCount(0);

    // retry 只重试字体链，不产生任何 document / history 写入；缺 glyph entry 仍被隔离。
    const retry = page.getByTestId(P0_TEST_ID.textResourceRetry);
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByTestId(P0_TEST_ID.textResourceStatus)).toContainText('error 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('图片资源：同 data URL 重复导入复用同一资源记录，无效 MIME 被拒绝且零写入', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    // 限制文案与导入态如实暴露 policy / registry-first 语义。
    await expect(page.getByTestId(P0_TEST_ID.imageImportPolicy)).toContainText('PNG/JPEG/WebP');
    await expect(page.getByTestId(P0_TEST_ID.imageImportState)).toContainText('registry-first');
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 0');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    const fileInput = page.getByTestId(TEST_ID.imageFileInput);
    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles(ONE_PIXEL_PNG_FILE as never);
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('已导入 1×1');
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);

    // 再次导入完全相同的内容：命中同一 data URL，复用既有 resourceId，资源记录数保持 1。
    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles(ONE_PIXEL_PNG_FILE as never);
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('已导入 1×1');
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);

    // undo 回退第二次导入；第一条仍引用该资源，故不得释放，资源计数仍为 1。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 1);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');

    // 无效 MIME（同样 PNG 字节但声明 text/plain）在解码前被冻结拒绝：零资源、零 history。
    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
    } as never);
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('失败');
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('text/plain');
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('尺边重入与稀疏跨越：外→进入→离开→再进入及整段跳过都只提交一条 pen stroke', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page);

    const center = await centerOfTestId(page, TEST_ID.rulerBackground);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');
    // 尺高 42，半高 21；±6 落在条带内，±120 在条带外；起点在条带外决定初始最近边。
    const x = center.x + 40;
    const above = center.y - 120;
    const insideTop = center.y - 6;
    const below = center.y + 120;
    const insideBottom = center.y + 6;

    // 外 → 进入 → 离开 → 再进入 → up：候选期间零写入，up 后恰好一条。
    await dragScreenPath(page, [
      { x, y: above },
      { x, y: insideTop },
      { x, y: below },
      { x, y: insideBottom },
    ]);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.status)).toContainText('Pen已提交一次');
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    // 稀疏跨越：单步从条带外直接跳到另一侧，完全跳过条带；仍恰好一条、零额外提交。
    await dragScreenPath(
      page,
      [
        { x: x + 30, y: above },
        { x: x + 30, y: below },
      ],
      1
    );
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.rulerRotation)).toHaveText('0 deg');

    // 边界：吸附后的几何与 sparse crossing 的“不补造”无 DOM/point 暴露，仅以上述
    // 提交次数与尺子旋转不变做最窄断言，不宣称任何吸附坐标或内部轨迹。
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 8.1 / 8.2 / 8.5 的补充边界证据。所有场景只从正式根 `/` 进入 Chromium Web 的真实 CanvasKit；
 * 不推断 native、系统 IME 候选窗 / caret、GPU 或性能表现。已有 MIME / 同 data URL 去重场景保留在
 * 上方 P0 describe，此处只补其未覆盖的 Web 可观察边界。
 */
test.describe('候选编辑器根路径（/）8.1/8.2/8.5 Chromium Web 边界证据（Web-only）', () => {
  test('多行文本完成：textarea 消失、document/history 恰 +1，frame ready 且已提交文本可观察', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_PATH);

    const multiline = 'first line\nsecond line';
    await page.getByTestId(TEST_ID.textCreate).click();
    const editor = page.getByTestId(TEST_ID.textArea);
    await editor.fill(multiline);
    await expect(editor).toHaveValue(multiline);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    await page.getByTestId(TEST_ID.textDone).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    // frame 与已提交文本面板分别证明这不是仍停留在 textarea 的草稿状态。
    await expect(page.getByTestId(FRAME_TEST_ID.frameDiagnostics)).toContainText(
      'Frame ready · visible 1'
    );
    await expect(page.getByTestId(FRAME_TEST_ID.frameUnresolved)).toHaveText('未解决裁剪 0');
    await expect(page.getByTestId(`${P0_TEST_ID.textEntryStatusPrefix}0`)).toContainText('text[0]');
    await expect(page.getByText('“first line\nsecond line”')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('混合 Unicode composition：换行不参与 glyph 覆盖，tier ready 后 frame 可渲染且命中回填原串', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_PATH);

    // `文`（U+6587）由生产 CJK 资产 lane 纳入 subset；严格保留 ZWJ emoji 与硬换行原串。
    const mixed = '中文 CJK + Latin 👨‍👩‍👧‍👦\nsecond line';
    await page.getByTestId(TEST_ID.textCreate).click();
    const editor = page.getByTestId(TEST_ID.textArea);
    await editor.dispatchEvent('compositionstart');
    await editor.fill(mixed);
    // 只读取 Web textarea 的 code-unit selection，不将其误称为系统 IME 候选或 native caret。
    const selection = await editor.evaluate((element) => {
      const textarea = element as unknown as {
        selectionEnd: number | null;
        selectionStart: number | null;
        value: string;
      };
      return {
        end: textarea.selectionEnd,
        length: textarea.value.length,
        start: textarea.selectionStart,
      };
    });
    expect(Number.isFinite(selection.start)).toBe(true);
    expect(Number.isFinite(selection.end)).toBe(true);
    expect(selection.start!).toBeGreaterThanOrEqual(0);
    expect(selection.end!).toBeGreaterThanOrEqual(selection.start!);
    expect(selection.end!).toBeLessThanOrEqual(selection.length);

    await page.getByTestId(TEST_ID.textDone).click();
    await expect(editor).toBeVisible();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);

    await editor.dispatchEvent('compositionend');
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 1');
    await expectHistory(page, 1, 0);
    // 两个 on-demand tier 必须在明确超时内实际 ready；不能将 pending/error 的 empty-text 当成功。
    await expectTextChainReady(page, {
      assetIds: ['latin', 'cjk-on-demand', 'emoji-on-demand'],
      readyCount: 1,
    });
    await expect(page.getByTestId(`${P0_TEST_ID.textEntryStatusPrefix}0`)).toHaveText(
      'text[0] ready'
    );
    await expect(page.getByTestId(FRAME_TEST_ID.frameDiagnostics)).toHaveText(
      'Frame ready · visible 1 · renderable 1'
    );
    await expect(page.getByTestId(FRAME_TEST_ID.frameUnresolved)).toHaveText('未解决裁剪 0');

    // 有限 Canvas readback：只要求首行附近存在连续非背景簇，不假设具体字形、颜色或绝对像素。
    const screenshot = await readCanvasScreenshot(page.getByTestId(TEST_ID.canvas), 1);
    const firstLine = readCanvasCssRegion(
      screenshot,
      { x: 102, y: 100, width: 180, height: 34 },
      '混合 Unicode 首行文本区域'
    );
    expect(largestDarkOrColoredCluster(firstLine)).toBeGreaterThanOrEqual(
      TEXT_TIER_MINIMUM_CLUSTER_CSS_PIXELS * screenshot.pixelAreaPerCssPixel
    );

    // 正式 frame 的既有 text hit 路径必须回填逐 code-unit 相同的文本，包含 ZWJ 与换行。
    await selectTool(page, 'text');
    // 「新建文本」的首个确定性 origin 为 (100, 98)；偏移至首行 Paragraph 的内部区域，走
    // frame-only hit，而非工具栏的稳定 edit 按钮。
    await clickCanvasWorldOffset(page, { x: 100, y: 98 }, 24, 12);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(mixed);
    await page.getByTestId(TEST_ID.textCancel).click();
    await expect(editor).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('file input 无 files 的 change 与 cancel：document/history/resource 均零写入', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_PATH);

    const fileInput = page.getByTestId(TEST_ID.imageFileInput);
    await page.getByTestId(TEST_ID.imageImport).click();
    // Chromium DOM 的空 files change 直接走产品 onChange 的取消分支，不伪造文件选择成功。
    await fileInput.evaluate((element) => {
      Object.defineProperty(element, 'files', { configurable: true, value: null });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('已取消');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 0');

    // 原生 file input cancel 同样只是取消操作 token，不能落入 document 或资源 registry。
    await fileInput.dispatchEvent('cancel');
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('已取消');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('8193×1 PNG header 超限：解码尺寸拒绝且不分配大文件、不写入 document/history/resource', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_PATH);

    await page.getByTestId(TEST_ID.imageImport).click();
    await page.getByTestId(TEST_ID.imageFileInput).setInputFiles({
      name: 'over-edge-8193x1.png',
      mimeType: 'image/png',
      buffer: Buffer.from(OVER_EDGE_PNG_BASE64, 'base64') as never,
    });
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('失败');
    await expect(page.getByTestId(TEST_ID.imageImportStatus)).toContainText('图片尺寸超限');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 0, 0);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('两种资源经 clear/undo/redo 仍在 document 或 history 可达时绝不释放', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_PATH);

    const fileInput = page.getByTestId(TEST_ID.imageFileInput);
    const releases = page.getByTestId(TEST_ID.imageReleaseDiagnostics);
    await expect(releases).toHaveAttribute('data-last-release', '0');
    await expect(releases).toHaveAttribute('data-release-total', '0');

    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles({
      name: 'first.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64') as never,
    });
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 1');
    await expectHistory(page, 1, 0);

    await page.getByTestId(TEST_ID.imageImport).click();
    await fileInput.setInputFiles({
      name: 'second.png',
      mimeType: 'image/png',
      buffer: Buffer.from(SECOND_ONE_PIXEL_PNG_BASE64, 'base64') as never,
    });
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 2');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 0);

    // clear 让 document 不再引用，但 clear 前快照在 undo 中，资源必须继续保留。
    await page.getByTestId(TEST_ID.clear).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 3, 0);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 2');
    await expect(releases).toHaveAttribute('data-release-total', '0');

    // undo 让 document 可达；redo 又让 redo/undo 历史可达。两种状态均不得提前释放。
    await page.getByTestId(TEST_ID.undo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 2');
    await expectHistory(page, 2, 1);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 2');
    await expect(releases).toHaveAttribute('data-release-total', '0');

    await page.getByTestId(TEST_ID.redo).click();
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');
    await expectHistory(page, 3, 0);
    await expect(page.getByTestId(TEST_ID.resourceCount)).toContainText('资源 2');
    await expect(releases).toHaveAttribute('data-release-total', '0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * 生命周期计数只在显式 diagnostics query 下出现；它们通过命令式 data 属性提供给外部轮询，
 * 不订阅或修改产品 state。该用例只验证可观察的 generation/frame/canvas 边界，不声称捕获浏览器
 * renderer 进程级 crash。
 */
test.describe('候选编辑器根路径（/）生命周期诊断（Web-only）', () => {
  test('diagnostics=1：字体 provider 替换递增 resource revision，Canvas 保持单次挂载', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, `${EDITOR_PATH}?diagnostics=1`);

    const diagnostics = page.getByTestId(TEST_ID.lifecycleDiagnostics);
    await expect(diagnostics).toBeAttached();
    await expect(diagnostics).toHaveAttribute('data-route-phase', 'frame-ready');
    await expect(diagnostics).toHaveAttribute('data-resource-revision', /[1-9]\d*/);
    await expect(diagnostics).toHaveAttribute('data-provider-identity', /^provider-\d+$/);
    await expect(diagnostics).toHaveAttribute(
      'data-layout-status',
      /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/
    );

    const before = await diagnostics.evaluate((element) => {
      const attributes = element as unknown as { getAttribute(name: string): string | null };
      return {
        resourceRevision: Number(attributes.getAttribute('data-resource-revision')),
        providerIdentity: attributes.getAttribute('data-provider-identity'),
        canvasMounts: Number(attributes.getAttribute('data-canvas-mounts')),
        canvasUnmounts: Number(attributes.getAttribute('data-canvas-unmounts')),
        frameBuilds: Number(attributes.getAttribute('data-frame-builds')),
      };
    });
    expect(before.resourceRevision).toBeGreaterThan(0);
    // Dev Strict Mode may probe mount cleanup. Provider replacement itself must add neither count.
    expect(before.canvasMounts).toBeGreaterThanOrEqual(1);

    // CJK tier 导致 FontManager/provider 原子替换。旧 provider 的 records 不得映射到新 cache。
    await commitTextAt(page, TEXT_TIERS[1]);
    await expectTextChainReady(page, { assetIds: ['latin', 'cjk-on-demand'], readyCount: 1 });
    await expect
      .poll(async () => Number(await diagnostics.getAttribute('data-resource-revision')))
      .toBeGreaterThan(before.resourceRevision);
    await expect(diagnostics).not.toHaveAttribute(
      'data-provider-identity',
      before.providerIdentity!
    );

    const after = await diagnostics.evaluate((element) => {
      const attributes = element as unknown as { getAttribute(name: string): string | null };
      return {
        canvasMounts: Number(attributes.getAttribute('data-canvas-mounts')),
        canvasUnmounts: Number(attributes.getAttribute('data-canvas-unmounts')),
        frameBuilds: Number(attributes.getAttribute('data-frame-builds')),
        effectsCreated: Number(attributes.getAttribute('data-font-effects-created')),
        effectsPublished: Number(attributes.getAttribute('data-font-effects-published')),
      };
    });
    expect(after.canvasMounts).toBe(before.canvasMounts);
    expect(after.canvasUnmounts).toBe(before.canvasUnmounts);
    expect(after.frameBuilds).toBeGreaterThan(before.frameBuilds);
    expect(after.effectsCreated).toBeGreaterThanOrEqual(2);
    expect(after.effectsPublished).toBeGreaterThanOrEqual(2);
    await expect(page.locator('canvas')).toHaveCount(1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * D1 路由分段诊断（Web-only）：仅在 `?diagnostics=1&diagStage=<value>` 同时出现时隔离
 * LoadSkiaWeb、两个动态 import 与 Surface 边界。
 *
 * evidence 强度与局限（如实声明，不虚构）：
 *  - 只断言路由通过命令式 `data-route-phase` 暴露的**真实到达阶段**，不使用超时伪造状态，
 *    也不把“导入成功”当作 Surface 可正常挂载 / 渲染或 native 能力证据；
 *  - load-skia / imports 两个隔离阶段都**不挂载** Surface，因此这两个用例不会出现 `<canvas>`，
 *    也不代表 OpenSpec 任务 7.4 完成；
 *  - 失败注入（让某个 import 抛错以观察 error 阶段）需要改动产品源，本组不伪造该分支。
 */
test.describe('候选编辑器根路径（/）D1 路由分段诊断（Web-only）', () => {
  test('diagStage=load-skia：只完成 CanvasKit 加载并报告 load-skia-ready，不动态 import、不挂载 Surface', async ({
    page,
  }) => {
    await page.goto(`${EDITOR_PATH}?diagnostics=1&diagStage=load-skia`);

    const diagnostics = page.getByTestId('editor-candidate-route-diagnostics');
    await expect(diagnostics).toBeAttached({ timeout: 90_000 });
    // 路由真实到达 load-skia-ready，而不是靠超时兜底出的假状态。
    await expect(diagnostics).toHaveAttribute('data-route-phase', 'load-skia-ready', {
      timeout: 90_000,
    });
    // 隔离阶段绝不挂载 Surface：没有 canvas，也没有错误态。
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
  });

  test('diagStage=imports：CanvasKit 后两个动态 import 均成功并报告 surface-import-ready，不挂载 Surface', async ({
    page,
  }) => {
    await page.goto(`${EDITOR_PATH}?diagnostics=1&diagStage=imports`);

    const diagnostics = page.getByTestId('editor-candidate-route-diagnostics');
    await expect(diagnostics).toBeAttached({ timeout: 90_000 });
    // skia 与 surface 的动态 import 都真实 resolve 后才报告该阶段。
    await expect(diagnostics).toHaveAttribute('data-route-phase', 'surface-import-ready', {
      timeout: 90_000,
    });
    // imports 阶段仍不挂载 Surface。
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
  });
});

/**
 * D2 在已完成 CanvasKit 与 Surface import 后验证 Surface 本身的生命周期。它只抑制原有
 * SkiaDrawingCanvas JSX，不替换 controller、布局、frame、字体或 shaping 的生产路径。
 */
test.describe('候选编辑器根路径（/）D2 Surface 无 Canvas 二分（Web-only）', () => {
  test('surface-no-canvas：Surface 生命周期稳定推进且从不挂载 Canvas', async ({ page }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await page.goto(`${EDITOR_PATH}?diagnostics=1&diagStage=surface-no-canvas`);

    await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
    const marker = page.getByTestId(TEST_ID.surfaceDiagnostics);
    const lifecycle = page.getByTestId(TEST_ID.lifecycleDiagnostics);
    await expect(marker).toBeAttached({ timeout: 90_000 });
    await expect(marker).toHaveAttribute('data-canvas-suppressed', 'true');
    await expect(marker).toHaveAttribute(
      'data-surface-phase',
      /^(?:surface-starting|layout-ready|frame-ready|font-pending|font-ready|font-error)$/,
      { timeout: 90_000 }
    );
    await expect(lifecycle).toBeAttached();
    await expect(lifecycle).toHaveAttribute('data-layout-status', /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/);
    await expect(lifecycle).toHaveAttribute('data-route-phase', 'frame-ready');
    await expect(marker).toHaveAttribute('data-surface-phase', /^(?:font-ready|font-error)$/);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);

    // 使用既有 Surface 文本入口触发真实 CJK tier fetch、Typeface/provider generation 与 shaping。
    await commitTextAt(page, TEXT_TIERS[1]);
    await expect(page.getByTestId(FRAME_TEST_ID.textAssets)).toContainText('cjk-on-demand', {
      timeout: 30_000,
    });
    await expect(page.getByTestId(FRAME_TEST_ID.textShapingStatus)).toContainText('shaping ready', {
      timeout: 30_000,
    });
    await expect(page.getByTestId(FRAME_TEST_ID.textShapingStatus)).toContainText('ready 1');
    await expect(marker).toHaveAttribute('data-surface-phase', 'font-ready');

    const readStableCounters = async () =>
      lifecycle.evaluate((element) => {
        const attributes = element as unknown as { getAttribute(name: string): string | null };
        return {
          layoutChanges: Number(attributes.getAttribute('data-layout-changes')),
          frameBuilds: Number(attributes.getAttribute('data-frame-builds')),
          resourceRevision: Number(attributes.getAttribute('data-resource-revision')),
        };
      });
    const before = await readStableCounters();
    expect(before.layoutChanges).toBeGreaterThan(0);
    expect(before.frameBuilds).toBeGreaterThan(0);
    expect(before.resourceRevision).toBeGreaterThan(0);

    // 等待一个短窗口，确认空 document 下的真实布局、frame 与字体 generation 已静止。
    await page.waitForTimeout(1_200);
    expect(await readStableCounters()).toEqual(before);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/**
 * D3 仅改变真实 SkiaDrawingCanvas 接收的负载，不替换 renderer 或经由 key 重建 Canvas。
 * 该用例选取最小负载阶段：空 frame、空 overlays，且不向 Canvas 传递字体、图片或文本资源。
 */
test.describe('候选编辑器根路径（/）D3 Canvas 单变量诊断（Web-only）', () => {
  const diagnosticCases = [
    { stage: 'canvas-empty-no-font', phase: 'empty-canvas-mounted' },
    { stage: 'canvas-empty-font', phase: 'empty-canvas-mounted' },
    { stage: 'canvas-current-no-font', phase: 'current-payload-mounted' },
  ] as const;

  for (const diagnosticCase of diagnosticCases) {
    test(`${diagnosticCase.stage}：真实 Skia Canvas 公开诊断负载与生命周期`, async ({ page }) => {
      const { consoleErrors, pageErrors } = recordProductErrors(page);
      await page.goto(`${EDITOR_PATH}?diagnostics=1&diagStage=${diagnosticCase.stage}`);

      const diagnostics = page.getByTestId(TEST_ID.canvasDiagnostics);
      await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
      await expect(diagnostics).toBeAttached({ timeout: 90_000 });
      await expect(diagnostics).toHaveAttribute('data-canvas-diag-stage', diagnosticCase.stage);
      await expect(diagnostics).toHaveAttribute('data-canvas-diag-phase', diagnosticCase.phase, {
        timeout: 90_000,
      });
      // Canvas 是路由加载的真实 SkiaDrawingCanvas，而不是 legacy 或空白替代节点。
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(diagnostics).toHaveAttribute('data-canvas-mounts', /[1-9]\d*/);
      await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
});

/**
 * D4 只把 D3 已稳定的“当前正式 frame”与已发布的 Latin FontOwner 合并。测试不注入空 frame、
 * 无字体过渡或替代 renderer；若页面崩溃或观察超时，失败信息会保留当时能读取到的 route/surface/
 * canvas/lifecycle 属性，结论仅限于这个组合触发，避免把失败归因到已经独立稳定的 D1-D3。
 */
test.describe('候选编辑器根路径（/）D4 当前 frame + FontOwner 组合诊断（Web-only）', () => {
  test('canvas-current-font：正式 frame、overlays 与已发布 FontOwner 首次合并挂载后生命周期稳定', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    const crashes: string[] = [];
    let lastSnapshot = '未能读取任何诊断属性';
    page.on('crash', () => {
      crashes.push('page crash');
    });

    const captureSnapshot = async () => {
      try {
        return await page.evaluate(() => {
          const attributes = (testId: string) => {
            const element = document.querySelector(`[data-testid="${testId}"]`);
            if (!element) return null;
            return Object.fromEntries(
              [...element.attributes].map((attribute) => [attribute.name, attribute.value])
            );
          };
          return JSON.stringify({
            route: {
              root: attributes('editor-candidate-root'),
              loading: attributes('editor-candidate-route-loading'),
              error: attributes('editor-candidate-route-error'),
            },
            surface: {
              root: attributes('editor-candidate-root'),
              frame: attributes('editor-candidate-frame-diagnostics'),
            },
            canvas: {
              count: document.querySelectorAll('canvas').length,
              diagnostics: attributes('editor-candidate-canvas-diagnostics'),
            },
            lifecycle: attributes('editor-candidate-canvas-diagnostics'),
          });
        });
      } catch {
        return null;
      }
    };

    try {
      await page.goto(`${EDITOR_PATH}?diagnostics=1&diagStage=canvas-current-font`);

      const diagnostics = page.getByTestId(TEST_ID.canvasDiagnostics);
      await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 90_000 });
      await expect(diagnostics).toBeAttached({ timeout: 90_000 });
      await expect(diagnostics).toHaveAttribute('data-canvas-diag-stage', 'canvas-current-font');
      await expect(diagnostics).toHaveAttribute(
        'data-canvas-diag-phase',
        'current-frame-font-mounted',
        {
          timeout: 90_000,
        }
      );
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(diagnostics).toHaveAttribute('data-resource-revision', /[1-9]\d*/);
      await expect(diagnostics).toHaveAttribute('data-provider-identity', /^provider-\d+$/);
      await expect(diagnostics).toHaveAttribute('data-canvas-mounts', /[1-9]\d*/);
      await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
      await expect(page.getByTestId(FRAME_TEST_ID.frameStatus)).toContainText('正式 frame 已挂载');

      const readStableCounters = async () =>
        diagnostics.evaluate((element) => {
          const attributes = element as unknown as { getAttribute(name: string): string | null };
          return {
            canvasMounts: Number(attributes.getAttribute('data-canvas-mounts')),
            canvasUnmounts: Number(attributes.getAttribute('data-canvas-unmounts')),
            frameBuilds: Number(attributes.getAttribute('data-frame-builds')),
            resourceRevision: Number(attributes.getAttribute('data-resource-revision')),
          };
        });
      const before = await readStableCounters();
      expect(before.canvasMounts).toBeGreaterThan(0);
      expect(before.frameBuilds).toBeGreaterThan(0);
      expect(before.resourceRevision).toBeGreaterThan(0);
      lastSnapshot = (await captureSnapshot()) ?? lastSnapshot;

      // 观察 1.2 秒：组合已经挂载后不得因诊断分支自行重建 Canvas、frame 或 FontOwner。
      await page.waitForTimeout(1_200);
      expect(await readStableCounters()).toEqual(before);
      await expect(diagnostics).toHaveAttribute(
        'data-canvas-diag-phase',
        'current-frame-font-mounted'
      );
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.getByTestId(TEST_ID.routeError)).toHaveCount(0);
      lastSnapshot = (await captureSnapshot()) ?? lastSnapshot;

      expect(crashes).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } catch (error) {
      lastSnapshot = (await captureSnapshot()) ?? lastSnapshot;
      throw new Error(
        `D4 current-frame + FontOwner 组合触发异常；crashes=${JSON.stringify(crashes)}; ` +
          `consoleErrors=${JSON.stringify(consoleErrors)}; pageErrors=${JSON.stringify(pageErrors)}; ` +
          `last=${lastSnapshot}; cause=${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
});

/**
 * 根切 canary（Web-only）：验证正式根 `/` 打开的是候选编辑器，且从首个 DOM mutation 起从未
 * 出现任何 legacy 多 demo 标识；同时覆盖阻断 CanvasKit 时的根失败态，以及 `/editor-candidate`
 * 兼容别名的单独证明。
 *
 * 边界：仅 Chromium Web + 同源真实 CanvasKit（或主动阻断其 wasm）；只做 DOM 语义与 canary
 * 计数断言，不覆盖 native、像素 / 截图比对或性能基线。
 */
test.describe('根切 canary：正式根 / 的候选编辑器与 legacy 隔离（Web-only）', () => {
  test('正常根路径：ready 后 pathname 为 /、从未出现 legacy 标识、canvas 最多且最终为 1', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await installRootSwitchCanary(page);
    await openCandidateEditor(page, EDITOR_PATH);

    // 正式路径就是根；不得重定向，也不得落到 legacy。
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');

    const canary = await readRootSwitchCanary(page);
    expect(canary.anyLegacy).toBe(false);
    expect(canary.legacyMarkersSeen).toEqual([]);
    expect(canary.maxCanvasCount).toBeLessThanOrEqual(1);
    await expect(page.locator('canvas')).toHaveCount(1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('失败态根 canary：阻断 canvaskit.wasm 后仍在 /、candidate route error + retry、canvas 0、从未 legacy、绝不回退', async ({
    page,
  }) => {
    await installRootSwitchCanary(page);
    // 阻断同源 CanvasKit：候选路由必须如实进入 error 失败态，不得重定向或自动回退 legacy。
    await page.route('**/canvaskit.wasm', (route) => route.abort());

    await page.goto(EDITOR_PATH);

    await expect(page.getByTestId(TEST_ID.routeError)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('editor-candidate-route-retry')).toBeVisible();

    // 给出潜在的自动重定向 / fallback 窗口；canary 会记录任何 legacy 出现。
    await page.waitForTimeout(1_500);

    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('canvas')).toHaveCount(0);
    const canary = await readRootSwitchCanary(page);
    expect(canary.anyLegacy).toBe(false);
    expect(canary.legacyMarkersSeen).toEqual([]);
  });

  test('兼容别名单独证明：/editor-candidate 仍挂载同一候选编辑器（不掩盖根路径失败）', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = recordProductErrors(page);
    await openCandidateEditor(page, EDITOR_ALIAS_PATH);

    expect(new URL(page.url()).pathname).toBe(EDITOR_ALIAS_PATH);
    await expect(page.getByTestId(TEST_ID.count)).toContainText('笔迹 0');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
