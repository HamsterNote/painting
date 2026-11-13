import { expect, type Page } from '@playwright/test';

export async function selectionFrame(page: Page) {
  return page.locator('[data-selection-frame]').evaluate((node) => {
    const g = node as SVGGElement;
    const rect = g.querySelector('rect[stroke-dasharray]')!;
    const region = g.querySelector('[data-selection-operation="move"]')!;
    const circle = g.querySelector('circle')!;
    const x = Number(rect.getAttribute('x')),
      y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width')),
      h = Number(rect.getAttribute('height'));
    const map = (x: number, y: number) => {
      const p = new DOMPoint(x, y).matrixTransform(g.getScreenCTM()!);
      return { x: p.x, y: p.y };
    };
    const rx = Number(region.getAttribute('x')),
      ry = Number(region.getAttribute('y'));
    const rw = Number(region.getAttribute('width')),
      rh = Number(region.getAttribute('height'));
    const corners = [map(x, y), map(x + w, y), map(x + w, y + h), map(x, y + h)];
    return {
      corners,
      center: map(x + w / 2, y + h / 2),
      resize: map(x + w, y + h),
      rotate: map(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))),
      region: [map(rx, ry), map(rx + rw, ry), map(rx + rw, ry + rh), map(rx, ry + rh)],
      angle: (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180) / Math.PI,
    };
  });
}
export async function dragSelection(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  release = true
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  if (release) await page.mouse.up();
}
export async function rotateSelection(page: Page, degrees: number, release = true) {
  const f = await selectionFrame(page);
  const a = (degrees * Math.PI) / 180,
    dx = f.rotate.x - f.center.x,
    dy = f.rotate.y - f.center.y;
  await dragSelection(
    page,
    f.rotate,
    {
      x: f.center.x + Math.cos(a) * dx - Math.sin(a) * dy,
      y: f.center.y + Math.sin(a) * dx + Math.cos(a) * dy,
    },
    release
  );
}
export async function expectSelectionAngle(page: Page, degrees: number) {
  await expect
    .poll(async () => {
      const actual = (await selectionFrame(page)).angle;
      return Math.abs(
        (Math.atan2(
          Math.sin(((actual - degrees) * Math.PI) / 180),
          Math.cos(((actual - degrees) * Math.PI) / 180)
        ) *
          180) /
          Math.PI
      );
    })
    .toBeLessThan(0.01);
}
