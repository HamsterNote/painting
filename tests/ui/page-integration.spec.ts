import { test, expect } from '@playwright/test';

for (const dpr of [1, 2, 3]) {
  test.describe(`page coordinate contract at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
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
