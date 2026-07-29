import { expect, type Locator, type Page, test } from '@playwright/test';

async function enableRuler(page: Page): Promise<{
  readonly surface: Locator;
  readonly ruler: Locator;
  readonly background: Locator;
}> {
  const toggle = page.getByTestId('drawing-ruler-toggle').first();
  await toggle.click();

  const surface = page.getByTestId('drawing-surface-uncontrolled');
  await surface.scrollIntoViewIfNeeded();
  const ruler = surface.getByTestId('drawing-ruler');
  const background = surface.getByTestId('drawing-ruler-background');
  await expect(ruler).toBeVisible();

  return { surface, ruler, background };
}

async function readRulerCenter(ruler: Locator): Promise<{ readonly x: number; readonly y: number }> {
  return {
    x: Number(await ruler.getAttribute('data-ruler-center-x')),
    y: Number(await ruler.getAttribute('data-ruler-center-y')),
  };
}

test.describe('ruler first-phase browser contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders only the configured translucent rectangle', async ({ page }) => {
    const { ruler, background } = await enableRuler(page);

    await expect(ruler).toHaveAttribute('data-ruler-length', '400');
    await expect(ruler).toHaveAttribute('data-ruler-height', '48');
    await expect(ruler).not.toHaveAttribute('data-ruler-rotation', /.+/);
    await expect(background).toHaveAttribute('fill-opacity', '0.2');
    await expect(background).not.toHaveAttribute('stroke', /.+/);
    await expect(background).not.toHaveAttribute('rx', /.+/);
    await expect(ruler.locator('rect')).toHaveCount(1);
    await expect(ruler.locator('circle, text')).toHaveCount(0);
  });

  test('plain left drag is blocked while Ctrl left drag translates the ruler', async ({ page }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const strokeCount = await surface.getAttribute('data-stroke-count');
    const initialCenter = await readRulerCenter(ruler);
    const box = await background.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 避开 playground 右下角的 minimap 覆盖层，确保真实指针命中尺子矩形。
    const startX = box.x + box.width * 0.2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY + 18, { steps: 4 });
    await page.mouse.up();

    await expect(surface).toHaveAttribute('data-stroke-count', strokeCount ?? '');
    await expect.poll(() => readRulerCenter(ruler)).toEqual(initialCenter);

    await page.keyboard.down('Control');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.keyboard.up('Control');
    await page.mouse.move(startX + 50, startY + 32, { steps: 6 });
    await page.mouse.up();

    await expect.poll(async () => {
      const center = await readRulerCenter(ruler);
      return { x: center.x - initialCenter.x, y: center.y - initialCenter.y };
    }).toEqual({ x: 50, y: 32 });
    await expect(surface).toHaveAttribute('data-stroke-count', strokeCount ?? '');
  });

  test('two ruler touches translate by their midpoint while an ignored third touch cannot interrupt them', async ({ page }) => {
    const { ruler, background } = await enableRuler(page);
    const initialCenter = await readRulerCenter(ruler);

    await background.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dispatch = (
        target: EventTarget,
        type: string,
        pointerId: number,
        clientX: number,
        clientY: number,
      ) => {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: 'touch',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX,
          clientY,
        }));
      };

      const y = rect.y + rect.height / 2;
      const firstX = rect.x + rect.width * 0.4;
      const secondX = rect.x + rect.width * 0.6;
      dispatch(element, 'pointerdown', 41, firstX, y);
      dispatch(document, 'pointermove', 41, firstX + 25, y + 10);

      dispatch(element, 'pointerdown', 42, secondX, y);
      dispatch(document, 'pointermove', 41, firstX + 40, y + 24);
      dispatch(document, 'pointermove', 42, secondX + 40, y + 24);
      dispatch(element, 'pointerdown', 43, (firstX + secondX) / 2, y);
      dispatch(document, 'pointerup', 43, (firstX + secondX) / 2, y);
      dispatch(document, 'pointermove', 41, firstX + 50, y + 30);
      dispatch(document, 'pointermove', 42, secondX + 50, y + 30);
      dispatch(document, 'pointerup', 41, firstX + 50, y + 30);
      dispatch(document, 'pointerup', 42, secondX + 50, y + 30);
    });

    await expect.poll(async () => {
      const center = await readRulerCenter(ruler);
      return { x: center.x - initialCenter.x, y: center.y - initialCenter.y };
    }).toEqual({ x: 37.5, y: 25 });
  });

  test('virtual-paper wheel remains available over the ruler', async ({ page }) => {
    const virtualPaperToggle = page.getByTestId('drawing-virtualpaper-toggle');
    await virtualPaperToggle.click();
    await expect(virtualPaperToggle).toHaveText('VirtualPaper ON');

    const { surface, background } = await enableRuler(page);
    const initialTx = Number(await surface.getAttribute('data-tx'));
    const initialTy = Number(await surface.getAttribute('data-ty'));
    const box = await background.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 尺子右半段可能被 minimap 覆盖；左侧点可验证滚轮从尺子穿透到虚拟纸。
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.wheel(45, 55);

    await expect.poll(async () => {
      const tx = Number(await surface.getAttribute('data-tx'));
      const ty = Number(await surface.getAttribute('data-ty'));
      return Math.abs(tx - initialTx) + Math.abs(ty - initialTy);
    }).toBeGreaterThan(0);
  });
});
