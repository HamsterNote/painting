import { expect, type Page } from '@playwright/test';

export async function openLayeredEditor(page: Page, query = '') {
  await page.goto(`/layered-editor?diagnostics=1${query}`);
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__layeredEditor));
}

export async function dispatchLayeredPointer(
  page: Page,
  phase: 'down' | 'move' | 'up' | 'cancel',
  point: { x: number; y: number },
  options: {
    source?: 'mouse' | 'pen' | 'touch';
    id?: number;
    pressure?: number;
    altKey?: boolean;
  } = {}
) {
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  await surface.dispatchEvent(`pointer${phase}`, {
    pointerId: options.id ?? 41,
    pointerType: options.source ?? 'pen',
    clientX: box.x + point.x,
    clientY: box.y + point.y,
    button: 0,
    buttons: phase === 'up' || phase === 'cancel' ? 0 : 1,
    pressure: options.pressure ?? (phase === 'up' ? 0 : 0.5),
    altKey: options.altKey ?? false,
  });
}

export async function layeredState(page: Page) {
  return page.evaluate(() => {
    const editor = window.__layeredEditor!;
    return {
      document: editor.getSnapshot('document'),
      history: editor.getSnapshot('history'),
      selection: editor.getSnapshot('selection'),
      viewport: editor.getSnapshot('viewport'),
      tools: editor.getSnapshot('tools'),
      navigation: editor.getSnapshot('navigation'),
      input: editor.getSnapshot('input'),
      preview: editor.getSnapshot('preview'),
    };
  });
}

export async function drawLayeredStroke(page: Page, y = 120) {
  await dispatchLayeredPointer(page, 'down', { x: 100, y });
  await dispatchLayeredPointer(page, 'move', { x: 180, y });
  await dispatchLayeredPointer(page, 'up', { x: 220, y }, { pressure: 0 });
}

export async function openToolbarSettings(page: Page) {
  if (await page.getByRole('dialog', { name: '绘图设置' }).isVisible()) return;
  const menu = page.getByRole('button', { name: '绘图菜单', exact: true });
  await menu.scrollIntoViewIfNeeded();
  if (!(await page.getByRole('menuitem', { name: '设置', exact: true }).isVisible()))
    await menu.click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
}

export async function selectToolbarTool(page: Page, label: string) {
  if (label === '文字') {
    await page.getByRole('button', { name: label, exact: true }).click();
    return;
  }
  const drawing = ['自由笔', '选择', '套索', '橡皮擦', '平移'].includes(label);
  const trigger = page.getByRole('button', { name: drawing ? '绘图菜单' : '形状和对象菜单' });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

export async function setToolbarInputMode(page: Page, mode: string) {
  await openToolbarSettings(page);
  await page.getByLabel('输入模式', { exact: true }).selectOption(mode);
  await page.keyboard.press('Escape');
}

export async function openToolbarZoom(page: Page) {
  if (await page.getByRole('dialog', { name: '缩放设置' }).isVisible()) return;
  await page.getByRole('button', { name: '缩放比例' }).click();
}
