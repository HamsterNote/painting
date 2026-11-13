import { expect, test, type Page } from '@playwright/test';

async function send(page: Page, phase: 'down' | 'move' | 'up', x: number, y: number) {
  await page.getByTestId('layered-surface').evaluate(
    (surface, sample) => {
      const box = surface.getBoundingClientRect();
      const event = new PointerEvent(`pointer${sample.phase}`, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'pen',
        button: 0,
        clientX: box.x + sample.x,
        clientY: box.y + sample.y,
      });
      // Native synthetic event timestamps do not follow Playwright's controlled clock.
      Object.defineProperty(event, 'timeStamp', { value: performance.now() });
      surface.dispatchEvent(event);
    },
    { phase, x, y }
  );
}

async function alphaAt(page: Page, points: number[][]) {
  return page.locator('[data-eraser-trail]').evaluate(async (svg, positions) => {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', '600');
    copy.setAttribute('height', '300');
    copy.style.width = '600px';
    copy.style.height = '300px';
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(copy))}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return positions.map(([x, y]) => ctx.getImageData(x!, y!, 1, 1).data[3]);
  }, points);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/painting.html?legacy');
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  const time = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
});

test('sample joints and self-crossings never accumulate alpha, including during fade', async ({
  page,
}) => {
  await send(page, 'down', 100, 100);
  for (const [x, y] of [
    [180, 100],
    [260, 100],
    [180, 180],
    [180, 60],
  ]) {
    await send(page, 'move', x!, y!);
  }
  const positions = [
    [140, 100],
    [260, 100],
    [180, 100],
    [180, 140],
  ];
  const initial = await alphaAt(page, positions);
  expect(initial.every((alpha) => Math.abs(alpha! - 115) <= 1)).toBe(true);
  await page.clock.runFor(400);
  const faded = await alphaAt(page, positions);
  expect(faded.every((alpha) => Math.abs(alpha! - 69) <= 1)).toBe(true);
  await send(page, 'up', 180, 60);
  await page.clock.runFor(608);
  await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
});

test('a five-second uninterrupted drag keeps only the last second and fades while held still', async ({
  page,
}) => {
  await send(page, 'down', 20, 100);
  for (let time = 100; time <= 5000; time += 100) {
    await page.clock.runFor(100);
    await send(page, 'move', 20 + time / 10, 100);
  }
  // At 5s, points from 4.1s / 4.5s / 4.9s have 10% / 50% / 90% life left.
  const pixels = await alphaAt(page, [
    [100, 100],
    [410, 100],
    [430, 100],
    [470, 100],
    [510, 100],
  ]);
  expect(pixels.slice(0, 2)).toEqual([0, 0]);
  for (const [index, expected] of [
    [2, 12],
    [3, 58],
    [4, 104],
  ]) {
    expect(Math.abs(pixels[index!]! - expected!)).toBeLessThanOrEqual(2);
  }
  expect(await page.locator('[data-eraser-trail] path').count()).toBeLessThanOrEqual(11);
  await page.clock.runFor(1008);
  await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
  await send(page, 'up', 520, 100);
  await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
});

test('different-age crossings use the newer coverage across separate gestures', async ({
  page,
}) => {
  await send(page, 'down', 50, 100);
  await send(page, 'move', 250, 100);
  await send(page, 'up', 250, 100);
  await page.clock.runFor(400);
  await send(page, 'down', 150, 40);
  await send(page, 'move', 150, 160);
  expect(
    await alphaAt(page, [
      [100, 100],
      [150, 100],
      [150, 60],
    ])
  ).toEqual([69, 115, 115]);
  await page.clock.runFor(400);
  const pixels = await alphaAt(page, [
    [100, 100],
    [150, 100],
    [150, 60],
  ]);
  expect(pixels).toEqual([23, 69, 69]);
  await page.clock.runFor(208);
  const expired = await alphaAt(page, [
    [100, 100],
    [150, 100],
    [150, 60],
  ]);
  expect(expired[0]).toBe(0);
  expect(expired[1]).toBe(expired[2]);
  await send(page, 'up', 150, 160);
  await page.clock.runFor(400);
  await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
});

for (const stationarySample of [true, false]) {
  test(`resuming after a five-second hold keeps the whole new segment (stationary sample=${stationarySample})`, async ({
    page,
  }) => {
    await send(page, 'down', 20, 100);
    await page.clock.runFor(5000);
    if (stationarySample) await send(page, 'move', 20, 100);
    await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
    await page.clock.runFor(10);
    await send(page, 'move', 120, 100);
    await expect(page.locator('[data-eraser-trail] path')).toHaveAttribute(
      'd',
      'M 20 100 L 120 100'
    );
    const positions = [
      [30, 100],
      [70, 100],
      [110, 100],
    ];
    expect((await alphaAt(page, positions)).every((alpha) => alpha! >= 113)).toBe(true);
    await page.clock.runFor(500);
    expect((await alphaAt(page, positions)).every((alpha) => alpha! >= 56 && alpha! <= 60)).toBe(
      true
    );
    await send(page, 'up', 120, 100);
    await page.clock.runFor(510);
    await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
  });
}
