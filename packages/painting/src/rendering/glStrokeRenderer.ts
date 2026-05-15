import type { Stroke } from '../state/strokes';

export interface GLStrokeRenderer {
  start(): void;
  // eslint-disable-next-line no-unused-vars
  updateStrokes(strokes: Stroke[]): void;
  // eslint-disable-next-line no-unused-vars
  setDimensions(width: number, height: number): void;
  cleanup(): void;
}

export function createGLStrokeRenderer(ctx: CanvasRenderingContext2D): GLStrokeRenderer {
  let strokes: Stroke[] = [];
  let width = 0;
  let height = 0;
  let frameId: number | null = null;
  let disposed = false;

  function hasDrawableSurface(): boolean {
    return width > 0 && height > 0;
  }

  function renderFrame() {
    if (disposed) {
      return;
    }

    if (hasDrawableSurface()) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      strokes.forEach((stroke) => {
        if (stroke.points.length < 2) {
          return;
        }

        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }

        ctx.stroke();
      });
    }

    frameId = requestAnimationFrame(renderFrame);
  }

  return {
    start() {
      if (disposed || frameId !== null) {
        return;
      }

      frameId = requestAnimationFrame(renderFrame);
    },
    updateStrokes(nextStrokes: Stroke[]) {
      if (disposed) {
        return;
      }

      strokes = nextStrokes;
    },
    setDimensions(nextWidth: number, nextHeight: number) {
      if (disposed) {
        return;
      }

      width = nextWidth;
      height = nextHeight;
    },
    cleanup() {
      disposed = true;

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },
  };
}
