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
type Point = { x: number; y: number };
type InputCapture = { start?: Point; end?: Point; stop: () => void };
type CaptureWindow = Window & { __selectionDrag?: InputCapture };

export function dragScale(drag: { start: Point; end: Point }, center: Point) {
  return (
    Math.hypot(drag.end.x - center.x, drag.end.y - center.y) /
    Math.hypot(drag.start.x - center.x, drag.start.y - center.y)
  );
}

export async function dragSelection(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  release = true
) {
  // Observe native delivery: WebKit quantizes mouse coordinates to CSS pixels.
  await page.evaluate(() => {
    const capture: InputCapture = { stop: () => {} };
    const down = (e: PointerEvent) => {
      capture.start = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      capture.end = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    capture.stop = () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
    };
    (window as CaptureWindow).__selectionDrag = capture;
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  if (release) await page.mouse.up();
  const delivered = await page.evaluate(() => {
    const capture = (window as CaptureWindow).__selectionDrag!;
    capture.stop();
    delete (window as CaptureWindow).__selectionDrag;
    return { start: capture.start!, end: capture.end! };
  });
  // At most one CSS pixel per axis is lost at each requested endpoint.
  // Keep this independent bound so an incorrect input path cannot define its own oracle.
  for (const [actual, requested] of [
    [delivered.start, start],
    [delivered.end, end],
  ]) {
    expect(Math.abs(actual.x - requested.x)).toBeLessThanOrEqual(1 + 1e-4);
    expect(Math.abs(actual.y - requested.y)).toBeLessThanOrEqual(1 + 1e-4);
  }
  return delivered;
}
export async function rotateSelection(page: Page, degrees: number, release = true) {
  const f = await selectionFrame(page);
  const a = (degrees * Math.PI) / 180,
    dx = f.rotate.x - f.center.x,
    dy = f.rotate.y - f.center.y;
  const delivered = await dragSelection(
    page,
    f.rotate,
    {
      x: f.center.x + Math.cos(a) * dx - Math.sin(a) * dy,
      y: f.center.y + Math.sin(a) * dx + Math.cos(a) * dy,
    },
    release
  );
  const angle = (p: Point) => Math.atan2(p.y - f.center.y, p.x - f.center.x);
  const delta =
    (Math.atan2(
      Math.sin(angle(delivered.end) - angle(delivered.start)),
      Math.cos(angle(delivered.end) - angle(delivered.start))
    ) *
      180) /
    Math.PI;
  // Two endpoint uncertainty disks (sqrt(2) CSS px) subtend this maximum angle.
  const radius = Math.hypot(dx, dy);
  const bound = (2 * Math.asin(Math.SQRT2 / radius) * 180) / Math.PI;
  expect(Math.abs(delta - degrees)).toBeLessThanOrEqual(bound + 1e-4);
  // Retain the strict 0.01 degree implementation check against delivered input.
  return f.angle + delta;
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
