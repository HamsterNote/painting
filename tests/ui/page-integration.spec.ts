import {
  selectionFrame,
  dragSelection,
  rotateSelection,
  expectSelectionAngle,
} from './selection-session-helpers';
import { test, expect } from '@playwright/test';

for (const dpr of [1, 2, 3]) {
  test.describe(`page coordinate contract at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test('disabled text drafts cannot commit or intercept the page; new edits work after enabling', async ({
      page,
    }) => {
      for (const submit of ['keyboard', 'button', 'composition']) {
        await page.goto('/?fixture=pages');
        await expect(page.getByTestId('layered-surface')).toHaveAttribute(
          'data-input-arbiter',
          'ready'
        );
        await page.evaluate(() => window.__pageEditors![0]!.setTool('text'));
        const box = await page.getByTestId('pdf-page').boundingBox();
        if (!box) throw new Error('Missing page');
        await page.mouse.click(box.x + 40, box.y + 50);
        const input = page.getByLabel('文字内容');
        await expect(input).toBeFocused();
        const oldInput = await input.elementHandle();
        const oldDone = await page
          .getByRole('button', { name: '完成', exact: true })
          .elementHandle();
        if (!oldInput || !oldDone) throw new Error('Missing editor');
        if (submit === 'composition') await input.dispatchEvent('compositionstart');
        await input.fill('discard this draft');
        if (submit === 'composition')
          await page.getByRole('button', { name: '完成', exact: true }).click();
        await page.getByRole('button', { name: 'Disable input' }).click();
        if (submit === 'keyboard') {
          await page.keyboard.press('Control+Enter');
          await oldInput.evaluate((node) =>
            node.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
            )
          );
        } else if (submit === 'button') await oldDone.evaluate((node) => node.click());
        else
          await oldInput.evaluate((node) =>
            node.dispatchEvent(
              new CompositionEvent('compositionend', { data: '未完成', bubbles: true })
            )
          );
        await expect(input).toHaveCount(0);
        await expect(page.locator('foreignObject')).toHaveCount(0);
        expect(
          await page.evaluate(() => window.__pageEditors![0]!.getSnapshot('document').objects)
        ).toEqual([]);
        await page.getByTestId('pdf-page').evaluate((node) => {
          node.addEventListener(
            'click',
            () => {
              (node as HTMLElement).dataset.clicked = 'yes';
            },
            { once: true }
          );
        });
        const point = { x: box.x + 80, y: box.y + 90 };
        expect(
          await page.evaluate(
            ({ x, y }) =>
              Boolean(
                document.elementFromPoint(x, y)?.closest('[data-testid="page-drawing-surface"]')
              ),
            point
          )
        ).toBe(false);
        await page.mouse.click(point.x, point.y);
        await expect(page.getByTestId('pdf-page')).toHaveAttribute('data-clicked', 'yes');
        await page.getByRole('button', { name: 'Enable input' }).click();
        await expect(input).toHaveCount(0);
        await page.mouse.click(box.x + 40, box.y + 50);
        await expect(input).toHaveValue('');
        await input.fill('fresh text');
        await page.getByRole('button', { name: '完成', exact: true }).click();
        const objects = await page.evaluate(
          () => window.__pageEditors![0]!.getSnapshot('document').objects
        );
        expect(objects).toHaveLength(1);
        expect(objects[0]).toMatchObject({ kind: 'text', content: 'fresh text' });
      }
    });

    test('read-only pages show the complete archive on first mount and remount and pass events through', async ({
      page,
    }) => {
      await page.goto('/?fixture=pages&readonly=1');
      const objects = page.getByTestId('layered-display').locator('[data-object-id]');
      await expect(objects).toHaveCount(4);
      const saved = await page.evaluate(() =>
        window.__pageEditors!.map((editor) => editor.getSnapshot('document'))
      );
      const assertArchive = async () => {
        await expect(objects).toHaveCount(4);
        for (const id of ['saved-pen', 'saved-rect', 'saved-text', 'saved-image'])
          await expect(page.locator(`[data-object-id="${id}"]`)).toBeVisible();
        await expect(page.locator('[data-object-id="saved-text"]')).toHaveText('Saved note');
        await expect(page.getByTestId('layered-surface')).not.toHaveAttribute(
          'data-input-arbiter',
          'ready'
        );
      };
      await assertArchive();
      const point = await page.locator('[data-object-id="saved-rect"] path').evaluate((node) => {
        const p = new DOMPoint(130, 50).matrixTransform(
          (node as SVGGraphicsElement).getScreenCTM()!
        );
        return {
          x: p.x,
          y: p.y,
          intercepted: Boolean(
            document.elementFromPoint(p.x, p.y)?.closest('[data-testid="page-drawing-surface"]')
          ),
        };
      });
      expect(point.intercepted).toBe(false);
      await page.mouse.click(point.x, point.y);
      await page.getByRole('button', { name: 'Switch page' }).click();
      await assertArchive();
      await page.getByRole('button', { name: 'Switch page' }).click();
      await page.getByRole('button', { name: 'Zoom page' }).click();
      await assertArchive();
      await page.getByRole('button', { name: 'Rotate page' }).click();
      await assertArchive();
      await page.getByRole('button', { name: 'Enable input' }).click();
      await expect(page.getByTestId('layered-surface')).toHaveAttribute(
        'data-input-arbiter',
        'ready'
      );
      await expect(objects).toHaveCount(4);
      await page.getByRole('button', { name: 'Disable input' }).click();
      await assertArchive();
      expect(
        await page.evaluate(() =>
          window.__pageEditors!.map((editor) => editor.getSnapshot('document'))
        )
      ).toEqual(saved);
    });

    test('page anchors align active Canvas and saved SVG across zoom, scrolling, rotation and pages', async ({
      page,
    }) => {
      await page.goto('/?fixture=pages');
      await expect(page.getByTestId('layered-surface')).toHaveAttribute('data-input-ready', 'true');
      const draw = async (rotated: boolean, scale: number) => {
        const box = await page.getByTestId('pdf-page').boundingBox();
        if (!box) throw new Error('Missing page');
        const point = (x: number, y: number) =>
          rotated
            ? { x: box.x + (800 - y) * scale, y: box.y + x * scale }
            : { x: box.x + x * scale, y: box.y + y * scale };
        await page.mouse.move(point(30, 50).x, point(30, 50).y);
        await page.mouse.down();
        await page.mouse.move(point(70, 50).x, point(70, 50).y, { steps: 8 });
        // Check actual Canvas pixels before up; this catches double CSS scale in the active layer.
        await expect
          .poll(() =>
            page.getByTestId('layered-drawing').evaluate((node) => {
              const canvas = node as HTMLCanvasElement;
              return canvas
                .getContext('2d')!
                .getImageData(
                  Math.round((50 * canvas.width) / canvas.clientWidth),
                  Math.round((50 * canvas.height) / canvas.clientHeight),
                  1,
                  1
                ).data[3];
            })
          )
          .toBeGreaterThan(0);
        await page.mouse.up();
      };
      await draw(false, 1);
      await page.getByRole('button', { name: 'Zoom page' }).click();
      await page.getByTestId('page-scroll').evaluate((node) => {
        node.scrollTop = 90;
      });
      await draw(false, 2.5);
      await page.getByRole('button', { name: 'Rotate page' }).click();
      // Keep the rotated anchor visible even in a narrow viewport.
      await page.getByTestId('page-scroll').evaluate((node) => {
        node.scrollLeft = 1400;
      });
      await draw(true, 2.5);
      const samples = await page.evaluate(() =>
        window
          .__pageEditors![0]!.getSnapshot('document')
          .objects.map((object) => (object.kind === 'freehand' ? object.samples : []))
      );
      expect(samples).toHaveLength(3);
      for (const stroke of samples) {
        expect(stroke[0]!.x).toBeCloseTo(30, 3);
        expect(stroke[0]!.y).toBeCloseTo(50, 3);
        expect(stroke[stroke.length - 1]!.x).toBeCloseTo(70, 3);
      }
      const paths = page.getByTestId('layered-display').locator('[data-object-id] path');
      await expect(paths).toHaveCount(3);
      for (let i = 0; i < 3; i++) await expect(paths.nth(i)).toHaveAttribute('fill', '#d02080');
      // Measure saved SVG in screen CSS pixels, independently of input sample assertions.
      const pageBox = await page.getByTestId('pdf-page').boundingBox();
      if (!pageBox) throw new Error('Missing rotated page');
      for (const path of await paths.all()) {
        const anchor = await path.evaluate((node) => {
          const matrix = (node as SVGGraphicsElement).getScreenCTM();
          if (!matrix) throw new Error('Missing SVG screen matrix');
          const point = new DOMPoint(30, 50).matrixTransform(matrix);
          return { x: point.x, y: point.y };
        });
        expect(Math.abs(anchor.x - (pageBox.x + (800 - 50) * 2.5))).toBeLessThanOrEqual(1);
        expect(Math.abs(anchor.y - (pageBox.y + 30 * 2.5))).toBeLessThanOrEqual(1);
      }
      await page.getByRole('button', { name: 'Switch page' }).click();
      await expect(paths).toHaveCount(0);
      await page.getByRole('button', { name: 'Switch page' }).click();
      await expect(paths).toHaveCount(3);
    });
  });
}

test('selection frame page mapping keeps empty-space drag aligned after host zoom and rotation', async ({
  page,
}) => {
  await page.goto('/?fixture=pages');
  await expect(page.getByTestId('layered-surface')).toHaveAttribute('data-input-ready', 'true');
  await page.evaluate(() => window.__pageEditors![0]!.setTool('ellipse'));
  let box = (await page.getByTestId('pdf-page').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 150);
  await page.mouse.up();
  await page.evaluate(() => window.__pageEditors![0]!.setTool('selection'));
  await page.mouse.click(box.x + 30, box.y + 100);
  await page.getByRole('button', { name: 'Zoom page' }).click();
  await page.getByRole('button', { name: 'Rotate page' }).click();
  await page.getByTestId('page-scroll').evaluate((node) => {
    node.scrollLeft = 1400;
  });
  box = (await page.getByTestId('pdf-page').boundingBox())!;
  const start = { x: box.x + (800 - 100) * 2.5, y: box.y + 80 * 2.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 50, start.y + 75);
  await page.mouse.up();
  const objects = await page.evaluate(
    () => window.__pageEditors![0]!.getSnapshot('document').objects
  );
  expect(objects).toHaveLength(1);
  expect(objects[0].transform.tx).toBeCloseTo(30, 3);
  expect(objects[0].transform.ty).toBeCloseTo(20, 3);
});

for (const rotation of [0, 90, 180, 270])
  for (const zoom of [0.5, 1, 2]) {
    test(`selection session page angle ${rotation} zoom ${zoom} aligns multiselect move and handles`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1900, height: 1900 });
      await page.goto('/?fixture=pages');
      await expect(page.getByTestId('layered-surface')).toHaveAttribute('data-input-ready', 'true');
      await page.getByLabel('Page angle').selectOption(String(rotation));
      await page.getByLabel('Page scale').selectOption(String(zoom));
      await page.evaluate(() => {
        const c = window.__pageEditors![0]!;
        const shape = (id: string, x: number) => ({
          kind: 'shape' as const,
          objectId: id,
          objectRevision: 1,
          transformRevision: 1,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          shapeType: 'rect' as const,
          points: [
            { x, y: 200 },
            { x: x + 50, y: 260 },
          ],
          style: { color: '#000', width: 2, opacity: 1 },
        });
        c.editObjects({ expectedDocumentRevision: 0, upsert: [shape('a', 200), shape('b', 350)] });
        c.updateViewport({
          type: 'replace',
          expectedRevision: 0,
          viewport: { scale: 1, tx: 17, ty: 23 },
        });
        c.setTool('selection');
        c.setSelection(['a', 'b']);
      });
      await expectSelectionAngle(page, rotation);
      await rotateSelection(page, 30);
      await expectSelectionAngle(page, rotation + 30);
      let f = await selectionFrame(page);
      const dx = 12 * zoom,
        dy = 8 * zoom;
      await dragSelection(page, f.center, { x: f.center.x + dx, y: f.center.y + dy });
      await expectSelectionAngle(page, rotation + 30);
      const after = await selectionFrame(page);
      expect(after.center.x - f.center.x).toBeCloseTo(dx, 2);
      expect(after.center.y - f.center.y).toBeCloseTo(dy, 2);
      f = after;
      const width = Math.hypot(f.corners[1].x - f.corners[0].x, f.corners[1].y - f.corners[0].y);
      await dragSelection(page, f.resize, {
        x: f.center.x + (f.resize.x - f.center.x) * 1.1,
        y: f.center.y + (f.resize.y - f.center.y) * 1.1,
      });
      await expectSelectionAngle(page, rotation + 30);
      f = await selectionFrame(page);
      expect(
        Math.hypot(f.corners[1].x - f.corners[0].x, f.corners[1].y - f.corners[0].y)
      ).toBeCloseTo(width * 1.1, 2);
      await rotateSelection(page, 20);
      await expectSelectionAngle(page, rotation + 50);
      expect(
        await page.evaluate(
          () => window.__pageEditors![0]!.getSnapshot('document').documentRevision
        )
      ).toBe(5);
      await page.evaluate(() => {
        const c = window.__pageEditors![0]!;
        c.setSelection([]);
        c.setSelection(['a', 'b']);
      });
      await expectSelectionAngle(page, rotation);
    });
  }
