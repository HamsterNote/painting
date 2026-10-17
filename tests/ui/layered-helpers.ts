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
  options: { source?: 'mouse' | 'pen' | 'touch'; id?: number; pressure?: number } = {}
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
  });
}
