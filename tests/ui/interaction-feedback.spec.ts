import { expect, test, type Locator } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

async function expectUserSelect(locator: Locator, value: 'text' | 'none') {
  await expect
    .poll(() =>
      locator.evaluate((node) => {
        const style = getComputedStyle(node);
        return (
          style.getPropertyValue('user-select') || style.getPropertyValue('-webkit-user-select')
        );
      })
    )
    .toBe(value);
}

test('wheel feedback shows actual zoom above the pointer, clears, and never writes history', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  await surface.dispatchEvent('wheel', {
    clientX: box.x + 200,
    clientY: box.y + 200,
    deltaY: -240,
    ctrlKey: true,
  });
  const feedback = page.getByTestId('drawing-zoom-feedback');
  const state = await layeredState(page);
  await expect(feedback).toHaveText(Math.round(state.viewport.viewport.scale * 100) + '%');
  expect((await feedback.boundingBox())!.y).toBeLessThan(box.y + 200);
  expect(state.history.canUndo).toBe(false);
  await expect(feedback).toHaveCount(0);
});

test('touch zoom feedback follows the live midpoint inside the host', async ({ page }) => {
  await openLayeredEditor(page);
  await pointer(page, 'down', { x: 80, y: 150 }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: 200, y: 150 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 320, y: 150 }, { source: 'touch', id: 2 });
  const feedback = page.getByTestId('drawing-zoom-feedback');
  await expect(feedback).toHaveText('200%');
  const host = (await page.getByTestId('layered-surface').boundingBox())!;
  const bounds = (await feedback.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(host.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(host.x + host.width);
  expect(bounds.y + bounds.height).toBeLessThan(host.y + 150);
  await pointer(page, 'up', { x: 320, y: 150 }, { source: 'touch', id: 2 });
  await pointer(page, 'up', { x: 80, y: 150 }, { source: 'touch', id: 1 });
  await expect(feedback).toHaveCount(0);
  expect((await layeredState(page)).history.canUndo).toBe(false);
});

test('text permits native selection and replacement while the drawing host owns gestures', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', { x: 100, y: 100 });
  const input = page.getByLabel('文字内容');
  await input.fill('original 中文');
  await input.selectText();
  await input.press('Backspace');
  await input.pressSequentially('replacement');
  await expect(input).toHaveValue('replacement');
  await input.press('Control+Enter');
  expect((await layeredState(page)).document.objects[0]).toMatchObject({
    kind: 'text',
    content: 'replacement',
  });
});

test('native selection stays outside non-editing paper and inside editing controls', async ({
  page,
}, testInfo) => {
  await openLayeredEditor(page, '&fixture=mixed');
  const surface = page.getByTestId('layered-surface');
  const displayed = page.locator('[data-object-id="middle-text"] foreignObject div');
  await expectUserSelect(surface, 'none');
  await expect(surface).toHaveCSS('touch-action', 'none');
  await expectUserSelect(displayed, 'none');
  const callout = await surface.evaluate((node) => ({
    supported: CSS.supports('-webkit-touch-callout', 'none'),
    value: getComputedStyle(node).getPropertyValue('-webkit-touch-callout'),
  }));
  if (callout.supported) expect(callout.value).toBe('none');

  // This control is outside the surface and uses the browser's default mouse selection.
  await page.evaluate(() => {
    const outside = document.createElement('p');
    outside.id = 'outside-selection';
    outside.textContent = 'outside selectable text';
    outside.style.cssText =
      'position:fixed;bottom:0;right:0;z-index:10000;background:white;user-select:text';
    document.body.append(outside);
    const host = document.querySelector<HTMLElement>('[data-testid="layered-surface"]')!;
    host.addEventListener('dblclick', (event) => {
      host.dataset.doubleClickTrusted = String(event.isTrusted);
    });
  });
  const outside = page.locator('#outside-selection');
  await outside.dblclick({ position: { x: 24, y: 8 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('outside');
  const box = (await surface.boundingBox())!;
  await page.mouse.dblclick(box.x + 90, box.y + 150);
  await expect(surface).toHaveAttribute('data-double-click-trusted', 'true');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('outside');
  await outside.click({ position: { x: 24, y: 8 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.mouse.dblclick(box.x + 90, box.y + 150);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.mouse.move(box.x + 60, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');

  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', { x: 350, y: 300 });
  await pointer(page, 'up', { x: 350, y: 300 });
  const input = page.getByLabel('文字内容');
  await expectUserSelect(input, 'text');
  const size = page.getByLabel('文字字号');
  await expectUserSelect(size, 'text');
  await size.focus();
  await expect(size).toBeFocused();
  await input.fill('original replacement');
  await input.dblclick({ position: { x: 30, y: 15 } });
  expect(
    await input.evaluate((node: HTMLTextAreaElement) =>
      node.value.slice(node.selectionStart, node.selectionEnd).trim()
    )
  ).toBe('original');
  await input.press('Backspace');
  await expect(input).toHaveValue(/replacement/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await outside.dblclick({ position: { x: 24, y: 8 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('outside');
  await testInfo.attach('selection-boundary', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('selection-input-evidence', {
    body: JSON.stringify({ engine: testInfo.project.name, mouseDblclickTrusted: true, callout }),
    contentType: 'application/json',
  });
});

test('native double click still completes a polygon as one transaction', async ({ page }) => {
  await openLayeredEditor(page);
  await page.getByRole('button', { name: '多边形', exact: true }).click();
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 220, box.y + 100);
  await page.mouse.dblclick(box.x + 220, box.y + 240);
  const { document } = await layeredState(page);
  expect(document.objects).toHaveLength(1);
  expect(document.objects[0]).toMatchObject({
    kind: 'shape',
    shapeType: 'polygon',
    points: [
      { x: 100, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 240 },
    ],
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(document.objects);
});

for (const fixture of ['', '&fixture=mixed']) {
  test(`rapid synthetic pen strokes keep one transaction per stroke ${fixture || 'blank'}`, async ({
    page,
  }, testInfo) => {
    await openLayeredEditor(page, fixture);
    const initial = await layeredState(page);
    // DOM dispatch checks application routing only, not native iPad pen gestures.
    const trusted = await page.getByTestId('layered-surface').evaluate((host) => {
      const box = host.getBoundingClientRect();
      const events: boolean[] = [];
      for (let stroke = 0; stroke < 12; stroke++) {
        const y = box.y + 140 + stroke * 3;
        for (const [phase, x] of [
          ['down', 80],
          ['move', stroke % 2 ? 85 : 220],
          ['up', stroke % 2 ? 90 : 240],
        ] as const) {
          const event = new PointerEvent(`pointer${phase}`, {
            bubbles: true,
            cancelable: true,
            pointerId: 41,
            pointerType: 'pen',
            clientX: box.x + x,
            clientY: y,
            button: 0,
            buttons: phase === 'up' ? 0 : 1,
            pressure: phase === 'up' ? 0 : 0.5,
          });
          events.push(event.isTrusted);
          (document.elementFromPoint(box.x + x, y) ?? host).dispatchEvent(event);
        }
      }
      return [...new Set(events)];
    });
    expect(trusted).toEqual([false]);
    const after = await layeredState(page);
    expect(after.document.objects).toHaveLength(initial.document.objects.length + 12);
    expect(after.document.objects.slice(0, initial.document.objects.length)).toEqual(
      initial.document.objects
    );
    expect(
      after.document.objects
        .slice(initial.document.objects.length)
        .every((object) => object.kind === 'freehand')
    ).toBe(true);
    expect(after.document.documentRevision).toBe(initial.document.documentRevision + 12);
    await expect(page.getByLabel('文字内容')).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    for (let count = 11; count >= 0; count--) {
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect((await layeredState(page)).document.objects).toHaveLength(
        initial.document.objects.length + count
      );
    }
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    for (let count = 1; count <= 12; count++) {
      await page.getByRole('button', { name: '重做', exact: true }).click();
      expect((await layeredState(page)).document.objects).toHaveLength(
        initial.document.objects.length + count
      );
    }
    expect((await layeredState(page)).document.objects).toEqual(after.document.objects);
    await testInfo.attach('rapid-pen', {
      body: await page.getByTestId('layered-surface').screenshot(),
      contentType: 'image/png',
    });
  });
}

test('composition commit and cancel preserve editing and return to protected drawing', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', { x: 100, y: 100 });
  await pointer(page, 'up', { x: 100, y: 100 });
  const input = page.getByLabel('文字内容');
  // Synthetic composition exercises the edit session, not the system IME.
  await input.dispatchEvent('compositionstart');
  await input.fill('中文 original');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(input).toBeVisible();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await input.dispatchEvent('compositionend');
  await expect(input).toHaveCount(0);
  const committed = await layeredState(page);
  expect(committed.document.objects).toHaveLength(1);
  await pointer(page, 'down', { x: 110, y: 110 });
  await pointer(page, 'up', { x: 110, y: 110 });
  await expect(input).toHaveValue('中文 original');
  await input.dispatchEvent('compositionstart');
  await input.fill('取消');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect((await layeredState(page)).document).toEqual(committed.document);
  expect((await layeredState(page)).history).toEqual(committed.history);
  await page.getByRole('button', { name: '自由笔', exact: true }).click();
  await pointer(page, 'down', { x: 110, y: 110 });
  await pointer(page, 'move', { x: 220, y: 110 });
  await pointer(page, 'up', { x: 240, y: 110 });
  expect((await layeredState(page)).document.objects).toHaveLength(2);
  await expectUserSelect(page.getByTestId('layered-surface'), 'none');
});
