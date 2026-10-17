import { Canvas, Circle } from '@shopify/react-native-skia';

describe('Skia CanvasKit Jest baseline', () => {
  it('initializes CanvasKit and exposes Skia mock components', () => {
    expect(global.CanvasKit).toBeDefined();
    expect(Canvas).toBeDefined();
    expect(Circle).toBeDefined();
  });
});
