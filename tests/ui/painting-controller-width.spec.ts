import { expect, test } from '@playwright/test';
import { drawLayeredStroke, layeredState, openLayeredEditor } from './layered-helpers';

test('five nominal widths reach brush snapshots and do not modify earlier ink', async ({
  page,
}) => {
  await openLayeredEditor(page);
  for (const [index, width] of [1, 2, 4, 8, 16].entries()) {
    await page.getByLabel('笔宽', { exact: true }).fill(String(width));
    await drawLayeredStroke(page, 100 + index * 50);
    const object = (await layeredState(page)).document.objects.at(-1);
    expect(object).toMatchObject({ kind: 'freehand', brushSnapshot: { nominalSize: width } });
  }
  const objects = (await layeredState(page)).document.objects;
  expect(
    objects.filter((o) => o.kind === 'freehand').map((o) => o.brushSnapshot.nominalSize)
  ).toEqual([1, 2, 4, 8, 16]);
  await page.getByRole('button', { name: '套索', exact: true }).click();
  await expect(page.getByLabel('笔宽', { exact: true })).toHaveCount(0);
  expect((await layeredState(page)).document.objects).toEqual(objects);
});
