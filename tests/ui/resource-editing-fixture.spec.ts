import { expect, type Page, test } from '@playwright/test';

/**
 * `/resource-editing-fixture` Web 隔离入口的持久 E2E（阶段 8.3 证据）。
 *
 * 验证范围（仅 Web 真实 CanvasKit 路径）：
 *  - 初始文本 A 精确可见（textarea 初始 value + committed 可访问标记）；
 *  - 会话 1：多次 draft 后精确提交 B；会话 2：多次 draft 后精确提交 C；
 *  - 每个 draft 期间 commit/history 不增长；每次 commit 只 +1；
 *  - 两次成功提交形成两个独立撤销单元：第一次 undo 精确恢复 B，第二次 undo 精确恢复 A；
 *  - cancel 不写 document、不增加撤销单元。
 *
 * 断言依据：
 *  - 计数：`ResourceEditingSurface` 的 commit-count / history-count testID；
 *  - 精确文本：committed 条目的非视觉可访问标记（aria-label，携带精确已提交文本），
 *    绝不以“长度”代替文本相等；
 *  - 编辑层：真实 DOM `<textarea data-testid=...>` 的初始 value。
 *
 * 本测试不涉及、也不声称验证原生 IME、平台图片选择器或默认路由行为。
 */

/** 稳定 testID 常量，避免测试里散落硬编码字符串 */
const TEST_ID = {
  root: 'resource-editing-fixture-root',
  enter: 'resource-editing-fixture-enter',
  loading: 'resource-editing-fixture-loading',
  error: 'resource-editing-fixture-error',
  canvas: 'resource-editing-fixture-canvas',
  commitCount: 'resource-editing-fixture-commit-count',
  historyCount: 'resource-editing-fixture-history-count',
  strokeCount: 'resource-editing-fixture-stroke-count',
  textUndo: 'resource-editing-fixture-text-undo',
  textEditor: 'resource-editing-fixture-text-editor',
  textDone: 'resource-editing-fixture-text-done',
  textCancel: 'resource-editing-fixture-text-cancel',
  /** 初始可编辑文本笔迹（seed）的 committed 条目与“编辑”按钮 */
  committedText: 'resource-editing-fixture-committed-text-fixture-text-seed',
  editText: 'resource-editing-fixture-text-edit-fixture-text-seed',
} as const;

/** 初始文本 A（INITIAL_DOCUMENT 中 fixture-text-seed 的 text） */
const A = 'Edit Me 123';
/** 会话 1 的最终提交 B */
const B = 'Session-1 final B!';
/** 会话 2 的最终提交 C */
const C = 'Session-2 final C!';
/** 会话 1 的多次 draft（每次输入都不应写 document） */
const DRAFTS_B = ['Session-1 draft one', 'Session-1 draft two', 'Session-1 draft three'];
/** 会话 2 的多次 draft */
const DRAFTS_C = ['Session-2 draft one', 'Session-2 draft two', 'Session-2 draft three'];

/** 进入隔离入口并等待真实 CanvasKit 加载、surface 挂载完成 */
async function openFixture(page: Page): Promise<void> {
  await page.goto('/resource-editing-fixture');

  // 首屏就绪入口：点击后才从本地加载 CanvasKit（一次性重试标记会直接进入 loading）
  await expect(page.getByTestId(TEST_ID.root)).toBeVisible({ timeout: 60_000 });
  const enter = page.getByTestId(TEST_ID.enter);
  if (await enter.isVisible().catch(() => false)) {
    await enter.click();
  }

  // surface 挂载：committed 标记出现即代表 ResourceEditingSurface 已渲染
  await expect(page.getByTestId(TEST_ID.committedText)).toBeVisible({ timeout: 90_000 });
  // 路由 CanvasKit 成功加载：真实画布挂载（而非停留在 loading/error）
  await expect(page.getByTestId(TEST_ID.canvas)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId(TEST_ID.loading)).toHaveCount(0);
  await expect(page.getByTestId(TEST_ID.error)).toHaveCount(0);
}

/** 断言 commit / history 计数（整数精确相等，不使用长度替代） */
async function expectCounts(page: Page, commit: number, history: number): Promise<void> {
  await expect(page.getByTestId(TEST_ID.commitCount)).toHaveText(String(commit));
  await expect(page.getByTestId(TEST_ID.historyCount)).toHaveText(String(history));
}

/** 断言 committed 条目的精确文本（非视觉 aria-label，不是长度） */
async function expectCommittedText(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId(TEST_ID.committedText)).toHaveAttribute('aria-label', text);
}

/**
 * 打开 seed 文本编辑、多次 draft（每次都断言计数不增长），随后提交并断言精确结果。
 *
 * @param initialText 打开编辑时 textarea 的初始 value
 * @param finalText 最终提交的精确文本
 * @param beforeCommit 本会话开始前的 commit 数（提交后应为 beforeCommit + 1）
 * @param beforeHistory 本会话开始前的 history 数（提交后应为 beforeHistory + 1）
 */
async function commitSession(
  page: Page,
  initialText: string,
  drafts: readonly string[],
  finalText: string,
  beforeCommit: number,
  beforeHistory: number
): Promise<void> {
  await page.getByTestId(TEST_ID.editText).click();
  const editor = page.getByTestId(TEST_ID.textEditor);
  await expect(editor).toBeVisible();
  // 初始 value 精确等于上一单元的文本（A / B）
  await expect(editor).toHaveValue(initialText);

  // 多次 draft：每次输入只进 session，commit/history 均不得增长
  for (const draft of drafts) {
    await editor.fill(draft);
    await expect(editor).toHaveValue(draft);
    await expectCounts(page, beforeCommit, beforeHistory);
  }

  // 最终 draft + 完成：一次提交恰好 +1
  await editor.fill(finalText);
  await expect(editor).toHaveValue(finalText);
  await expectCounts(page, beforeCommit, beforeHistory);
  await page.getByTestId(TEST_ID.textDone).click();

  await expect(editor).toHaveCount(0);
  await expectCommittedText(page, finalText);
  await expectCounts(page, beforeCommit + 1, beforeHistory + 1);
}

test.describe('/resource-editing-fixture 资源/文本编辑持久 E2E', () => {
  test('两次会话各 commit+1 且形成两个独立撤销单元，撤销精确恢复 B、再恢复 A', async ({
    page,
  }) => {
    await openFixture(page);

    // 初始状态：A 精确可见，无提交、无历史、撤销不可用，笔迹数为 2（文本 + legacy 图片）
    await expectCounts(page, 0, 0);
    await expect(page.getByTestId(TEST_ID.strokeCount)).toHaveText('2');
    await expectCommittedText(page, A);
    await expect(page.getByTestId(TEST_ID.textUndo)).toBeDisabled();

    // 会话 1：多次 draft → 精确提交 B，commit/history 各 +1
    await commitSession(page, A, DRAFTS_B, B, 0, 0);
    await expect(page.getByTestId(TEST_ID.strokeCount)).toHaveText('2');
    await expect(page.getByTestId(TEST_ID.textUndo)).toBeEnabled();

    // 会话 2：再次编辑同一条文本，多次 draft → 精确提交 C，commit/history 各再 +1
    await commitSession(page, B, DRAFTS_C, C, 1, 1);
    await expect(page.getByTestId(TEST_ID.strokeCount)).toHaveText('2');

    // 第一次 undo：只精确恢复 B（history 回到 1，commit 数不受撤销影响）
    await page.getByTestId(TEST_ID.textUndo).click();
    await expectCommittedText(page, B);
    await expectCounts(page, 2, 1);

    // 第二次 undo：精确恢复 A（历史清空，撤销按钮不可用）
    await page.getByTestId(TEST_ID.textUndo).click();
    await expectCommittedText(page, A);
    await expectCounts(page, 2, 0);
    await expect(page.getByTestId(TEST_ID.textUndo)).toBeDisabled();
  });

  test('cancel 不写 document、不增加撤销单元（一次 undo 即回到初始 A）', async ({ page }) => {
    await openFixture(page);
    await expectCounts(page, 0, 0);
    await expectCommittedText(page, A);

    // 先建立第 1 个撤销单元：提交 B
    await commitSession(page, A, DRAFTS_B, B, 0, 0);

    // 打开编辑、多次 draft 后 cancel：document/count 均不得变化
    await page.getByTestId(TEST_ID.editText).click();
    const editor = page.getByTestId(TEST_ID.textEditor);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(B);
    for (const draft of DRAFTS_C) {
      await editor.fill(draft);
      await expect(editor).toHaveValue(draft);
      await expectCounts(page, 1, 1);
    }
    await page.getByTestId(TEST_ID.textCancel).click();
    await expect(editor).toHaveCount(0);

    // cancel 未产生任何 document 变更：文本仍是 B，commit/history 未增长
    await expectCommittedText(page, B);
    await expectCounts(page, 1, 1);

    // 关键证明：仅一次 undo 即精确回到初始 A —— cancel 没有新增撤销单元
    await page.getByTestId(TEST_ID.textUndo).click();
    await expectCommittedText(page, A);
    await expectCounts(page, 1, 0);
    await expect(page.getByTestId(TEST_ID.textUndo)).toBeDisabled();
  });
});
