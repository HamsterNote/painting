import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  drawLayeredStroke,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test('default editor keeps one Canvas mounted across drawing, tools and viewport updates', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const canvas = await page.getByTestId('layered-drawing').elementHandle();
  await drawLayeredStroke(page);
  const document = (await layeredState(page)).document;
  await page.getByLabel('缩放', { exact: true }).fill('200');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  expect((await layeredState(page)).document).toEqual(document);
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-object-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(document.objects);
});

test('mixed Unicode and newline composition commits once and is editable verbatim', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const content = 'Latin 中文 العربية 😀\n第二行';
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', { x: 100, y: 100 });
  await pointer(page, 'up', { x: 100, y: 100 });
  const input = page.getByLabel('文字内容');
  await input.dispatchEvent('compositionstart');
  await input.fill(content);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-object-id] foreignObject')).toHaveText(content);
  const before = (await layeredState(page)).document;
  await pointer(page, 'down', { x: 110, y: 110 });
  await pointer(page, 'up', { x: 110, y: 110 });
  await expect(input).toHaveValue(content);
  await input.press('Escape');
  expect((await layeredState(page)).document).toEqual(before);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});

test('selection preview cancel and no-op handles do not write history', async ({ page }) => {
  await openLayeredEditor(page, '&fixture=mixed');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pointer(page, 'down', { x: 230, y: 180 });
  await pointer(page, 'up', { x: 230, y: 180 });
  const original = await layeredState(page);
  expect(original.selection).toHaveLength(1);
  const handle = page.locator('[data-selection-operation="resize"]');
  await expect(handle).toBeVisible();
  await handle.dispatchEvent('pointerdown', {
    pointerId: 41,
    pointerType: 'pen',
    clientX: 260,
    clientY: 260,
    button: 0,
  });
  await pointer(page, 'move', { x: 300, y: 300 });
  await pointer(page, 'cancel', { x: 300, y: 300 });
  expect((await layeredState(page)).document).toEqual(original.document);
  expect((await layeredState(page)).history.canUndo).toBe(false);
  await handle.click();
  expect((await layeredState(page)).document).toEqual(original.document);
});

test('deleting selected text removes stale selection through undo and redo', async ({ page }) => {
  await openLayeredEditor(page, '&fixture=resources');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pointer(page, 'down', { x: 70, y: 70 });
  await pointer(page, 'up', { x: 70, y: 70 });
  expect((await layeredState(page)).selection).toEqual(['resource-text']);
  await page.evaluate(() => {
    const editor = window.__layeredEditor!;
    editor.editObjects({
      expectedDocumentRevision: editor.getSnapshot('document').documentRevision,
      removeIds: editor.getSnapshot('selection'),
    });
  });
  expect((await layeredState(page)).selection).toEqual([]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-object-id="resource-text"]')).toBeVisible();
  expect((await layeredState(page)).selection).toEqual([]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('[data-object-id="resource-text"]')).toHaveCount(0);
  expect((await layeredState(page)).selection).toEqual([]);
});

test('empty and cancelled file selection and invalid MIME never mutate the document', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await pointer(page, 'down', { x: 100, y: 100 });
  await (await chooser).setFiles([]);
  await pointer(page, 'up', { x: 100, y: 100 });
  const input = page.getByLabel('导入图片文件');
  await input.dispatchEvent('cancel');
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  const invalid = page.waitForEvent('filechooser');
  await pointer(page, 'down', { x: 100, y: 100 });
  await (
    await invalid
  ).setFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await pointer(page, 'up', { x: 100, y: 100 });
  await expect(page.getByRole('alert')).toContainText('仅支持');
  expect((await layeredState(page)).history.canUndo).toBe(false);
});

test('actual 8193x1 decoded image is rejected without a history entry', async ({ page }) => {
  await openLayeredEditor(page);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8193;
    canvas.height = 1;
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByRole('button', { name: '图片', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await pointer(page, 'down', { x: 100, y: 100 });
  await (
    await chooser
  ).setFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('alert')).toContainText('图片尺寸超限');
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  expect((await layeredState(page)).history.canUndo).toBe(false);
});

test('trackpad pan and Ctrl wheel preserve document history and one viewport authority', async ({
  page,
}) => {
  await openLayeredEditor(page, '&fixture=mixed');
  const before = await layeredState(page);
  const surface = page.getByTestId('layered-surface');
  await surface.dispatchEvent('wheel', { deltaX: 40, deltaY: 20, clientX: 100, clientY: 200 });
  const pan = await layeredState(page);
  expect(pan.viewport.viewport).toEqual({ scale: 1, tx: -40, ty: -20 });
  await surface.dispatchEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: 100, clientY: 200 });
  const zoom = await layeredState(page);
  expect(zoom.viewport.viewport.scale).toBeGreaterThan(1);
  expect(zoom.document).toEqual(before.document);
  expect(zoom.history).toEqual(before.history);
});
