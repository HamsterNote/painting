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
    };
  });
}

export async function drawLayeredStroke(page: Page, y = 120) {
  await dispatchLayeredPointer(page, 'down', { x: 100, y });
  await dispatchLayeredPointer(page, 'move', { x: 180, y });
  await dispatchLayeredPointer(page, 'up', { x: 220, y }, { pressure: 0 });
}
