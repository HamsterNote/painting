import { fitImageIntoViewport } from '../image';

describe('fitImageIntoViewport', () => {
  it('Given a large image and zoomed viewport When fitting Then centers it and caps both screen dimensions at half the container', () => {
    const points = fitImageIntoViewport({
      naturalWidth: 1000,
      naturalHeight: 500,
      containerWidth: 400,
      containerHeight: 300,
      viewport: { scale: 2, tx: 40, ty: 20 },
    });

    expect(points).toEqual([
      { x: 30, y: 40 },
      { x: 130, y: 90 },
    ]);
  });

  it('Given a small image When fitting Then preserves its intrinsic screen size and aspect ratio', () => {
    const points = fitImageIntoViewport({
      naturalWidth: 80,
      naturalHeight: 40,
      containerWidth: 400,
      containerHeight: 300,
      viewport: { scale: 2, tx: 0, ty: 0 },
    });

    expect(points).toEqual([
      { x: 80, y: 65 },
      { x: 120, y: 85 },
    ]);
  });
});
