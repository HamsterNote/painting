import { expect, test, type Page } from '@playwright/test';
import { dispatchLayeredPointer, openLayeredEditor } from './layered-helpers';

// Migrated from the CanvasKit fixture: exact content, draft isolation and undo boundaries remain.
const A = 'Edit Me 123';
const B = 'Session-1 final B!';
const C = 'Session-2 final C!';
const DRAFTS_B = ['Session-1 draft one', 'Session-1 draft two', 'Session-1 draft three'];
const DRAFTS_C = ['Session-2 draft one', 'Session-2 draft two', 'Session-2 draft three'];

async function documentSnapshot(page: Page) {
  return page.evaluate(() => window.__layeredEditor!.getSnapshot('document'));
}

async function openFixture(page: Page) {
  await openLayeredEditor(page, '&fixture=resources');
  await expect(page.locator('[data-object-id]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '文字', exact: true }).click();
}

async function editText(page: Page, expected: string) {
  await dispatchLayeredPointer(page, 'down', { x: 70, y: 70 });
  const editor = page.getByLabel('文字内容', { exact: true });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(expected);
  return editor;
}

async function expectCommittedText(page: Page, content: string) {
  await expect(page.locator('[data-object-id="resource-text"] foreignObject')).toHaveText(content);
  expect((await documentSnapshot(page)).objects[0]).toMatchObject({ kind: 'text', content });
}

async function commitSession(page: Page, initial: string, drafts: string[], final: string) {
  const before = await documentSnapshot(page);
  const image = before.objects[1];
  const editor = await editText(page, initial);
  for (const draft of [...drafts, final]) {
    await editor.fill(draft);
    await expect(editor).toHaveValue(draft);
    expect(await documentSnapshot(page)).toEqual(before);
  }
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expectCommittedText(page, final);
  const after = await documentSnapshot(page);
  expect(after.documentRevision).toBe(before.documentRevision + 1);
  expect(after.objects).toHaveLength(2);
  expect(after.objects[1]).toEqual(image);
}

test.describe('layered resource editing regression (migrated)', () => {
  test('two editing sessions each commit once; undo restores B then A exactly', async ({
    page,
  }) => {
    await openFixture(page);
    await expectCommittedText(page, A);
    await commitSession(page, A, DRAFTS_B, B);
    await commitSession(page, B, DRAFTS_C, C);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expectCommittedText(page, B);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expectCommittedText(page, A);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expectCommittedText(page, B);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expectCommittedText(page, C);
  });

  test('cancel leaves document untouched and creates no undo entry', async ({ page }) => {
    await openFixture(page);
    await commitSession(page, A, DRAFTS_B, B);
    const before = await documentSnapshot(page);
    const editor = await editText(page, B);
    await editor.dispatchEvent('compositionstart');
    for (const draft of DRAFTS_C) {
      await editor.fill(draft);
      expect(await documentSnapshot(page)).toEqual(before);
    }
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(await documentSnapshot(page)).toEqual(before);
    await expectCommittedText(page, B);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expectCommittedText(page, A);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  });
});
