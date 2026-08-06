import type { DrawingPoint } from '../components/DrawingSurface';
import type { DrawingViewport } from '../viewport';
import { screenToCanvas } from '../viewport';

export type FitImageIntoViewportOptions = {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly viewport: DrawingViewport;
};

/**
 * 按图片固有宽高比放入当前可见区域中央。
 * 尺寸约束在屏幕坐标中计算，确保缩放画布后仍以容器的一半为上限。
 */
export function fitImageIntoViewport({
  naturalWidth,
  naturalHeight,
  containerWidth,
  containerHeight,
  viewport,
}: FitImageIntoViewportOptions): [DrawingPoint, DrawingPoint] {
  const screenScale = Math.min(
    1,
    containerWidth / 2 / naturalWidth,
    containerHeight / 2 / naturalHeight
  );
  const canvasWidth = (naturalWidth * screenScale) / viewport.scale;
  const canvasHeight = (naturalHeight * screenScale) / viewport.scale;
  const center = screenToCanvas(
    { x: containerWidth / 2, y: containerHeight / 2 },
    viewport
  );

  return [
    { x: center.x - canvasWidth / 2, y: center.y - canvasHeight / 2 },
    { x: center.x + canvasWidth / 2, y: center.y + canvasHeight / 2 },
  ];
}
