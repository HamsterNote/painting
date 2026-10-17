/** @jest-environment node */

import {
  deriveSelectionFrame,
  deriveSelectionOverlayModel,
  hitTestSelectionOverlay,
} from '../../core';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

function rectangle(id: string, startX: number, startY: number, endX: number, endY: number): DrawingStrokeV2 {
  return { schemaVersion: 2, id, tool: 'rect', points: [{ x: startX, y: startY }, { x: endX, y: endY }] };
}

function target(index: number, stroke: DrawingStrokeV2) {
  return { index, expectedId: stroke.id, expectedTool: stroke.tool } as const;
}

describe('core/selectionFrame and selectionOverlay', () => {
  it('derives a conservative world AABB union from stable targets only', () => {
    const first = rectangle('first', 0, 0, 10, 10);
    const second = rectangle('second', 20, 5, 30, 20);
    const document: DrawingValueV2 = { schemaVersion: 2, strokes: [first, second] };

    expect(deriveSelectionFrame(document, [target(0, first), target(1, second)])).toEqual({
      // 默认 2 DIP stroke 需要纳入半宽，避免选框遗漏实际可见笔迹。
      minX: -1, minY: -1, maxX: 31, maxY: 21, width: 32, height: 22,
    });
    expect(deriveSelectionFrame(document, [target(0, first), target(0, first)])).toBeNull();
    expect(deriveSelectionFrame(document, [{ ...target(1, second), expectedId: 'stale' }])).toBeNull();
  });

  it('keeps degenerate paths interactive and uses conservative prepared visual bounds', () => {
    const horizontal: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'horizontal', tool: 'line', strokeWidth: 8,
      points: [{ x: 0, y: 3 }, { x: 20, y: 3 }],
    };
    const vertical: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'vertical', tool: 'line', strokeWidth: 6,
      points: [{ x: 8, y: 0 }, { x: 8, y: 20 }],
    };
    const single: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'single', tool: 'pen', strokeWidth: 10,
      points: [{ x: 30, y: 40, pressure: 0.1 }],
    };
    const rotated: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'rotated', tool: 'rect', strokeWidth: 4, rotationRad: Math.PI / 2,
      points: [{ x: 40, y: 0 }, { x: 60, y: 10 }],
    };
    const pressure: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'pressure', tool: 'pen', strokeWidth: 12,
      points: [{ x: 70, y: 5, pressure: 0.1 }, { x: 80, y: 5, pressure: 1 }],
    };
    const document: DrawingValueV2 = { schemaVersion: 2, strokes: [horizontal, vertical, single, rotated, pressure] };

    expect(deriveSelectionFrame(document, [target(0, horizontal)])).toEqual({
      minX: -4, minY: -1, maxX: 24, maxY: 7, width: 28, height: 8,
    });
    expect(deriveSelectionFrame(document, [target(1, vertical)])).toEqual({
      minX: 5, minY: -3, maxX: 11, maxY: 23, width: 6, height: 26,
    });
    expect(deriveSelectionFrame(document, [target(2, single)])).toEqual({
      minX: 25, minY: 35, maxX: 35, maxY: 45, width: 10, height: 10,
    });
    expect(deriveSelectionFrame(document, [target(3, rotated)])).toEqual({
      minX: 43, minY: -7, maxX: 57, maxY: 17, width: 14, height: 24,
    });
    expect(deriveSelectionFrame(document, [target(4, pressure)])).toEqual({
      minX: 64, minY: -1, maxX: 86, maxY: 11, width: 22, height: 12,
    });
  });

  it('uses prepared conservative bounds for rotated ellipse, text/image boxes, and cubic controls', () => {
    const ellipse: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'ellipse', tool: 'ellipse', rotationRad: Math.PI / 2,
      points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
    };
    const text: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'text', tool: 'text', text: 'x', fontSize: 16, rotationRad: Math.PI / 2,
      points: [{ x: 30, y: 0 }, { x: 50, y: 10 }],
    };
    const image: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'image', tool: 'image', src: 'memory://image', rotationRad: Math.PI / 2,
      points: [{ x: 60, y: 0 }, { x: 80, y: 10 }],
    };
    const cubic: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'cubic', tool: 'bezier',
      points: [{ x: 90, y: 0 }, { x: 190, y: 50 }, { x: -10, y: -50 }, { x: 100, y: 0 }],
    };
    const document: DrawingValueV2 = { schemaVersion: 2, strokes: [ellipse, text, image, cubic] };

    expect(deriveSelectionFrame(document, [target(0, ellipse)])).toEqual({
      minX: 4, minY: -6, maxX: 16, maxY: 16, width: 12, height: 22,
    });
    expect(deriveSelectionFrame(document, [target(1, text)])).toEqual({
      minX: 34, minY: -6, maxX: 46, maxY: 16, width: 12, height: 22,
    });
    expect(deriveSelectionFrame(document, [target(2, image)])).toEqual({
      minX: 64, minY: -6, maxX: 76, maxY: 16, width: 12, height: 22,
    });
    // 使用 cubic 控制点 hull 而非仅端点，不依赖轮廓采样也能保证 AABB 安全。
    expect(deriveSelectionFrame(document, [target(3, cubic)])).toEqual({
      minX: -11, minY: -51, maxX: 191, maxY: 51, width: 202, height: 102,
    });
  });

  it('keeps visual and hit handle dimensions in screen DIP at all supported viewport scales', () => {
    const frame = { minX: 10, minY: 20, maxX: 50, maxY: 40, width: 40, height: 20 };
    for (const scale of [0.25, 1, 8]) {
      const model = deriveSelectionOverlayModel(frame, { scale, tx: 30, ty: -10 });
      expect(model).not.toBeNull();
      expect(model?.handles.map((handle) => [handle.size, handle.hitSize])).toEqual([
        [10, 22], [10, 22], [10, 22], [10, 22], [10, 22],
      ]);
      expect(model?.frame).toEqual({
        minX: 10 * scale + 30, minY: 20 * scale - 10,
        maxX: 50 * scale + 30, maxY: 40 * scale - 10,
      });
    }
  });

  it('uses rotate, then four corner uniform-scale, then body move hit priority', () => {
    const model = deriveSelectionOverlayModel(
      { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 },
      { scale: 1, tx: 0, ty: 0 },
      { rotateOffset: 0, handleSize: 20, hitSlop: 0 }
    );
    expect(model).not.toBeNull();
    // rotate 与 top-left scale 故意重合，rotate 必须优先。
    expect(hitTestSelectionOverlay(model!, { x: 50, y: 0 })?.kind).toBe('rotate');
    expect(hitTestSelectionOverlay(model!, { x: 0, y: 0 })?.kind).toBe('uniform-scale');
    expect(hitTestSelectionOverlay(model!, { x: 50, y: 50 })?.kind).toBe('move');
    expect(hitTestSelectionOverlay(model!, { x: 120, y: 120 })).toBeNull();
    expect(model?.handles.filter((handle) => handle.kind === 'uniform-scale')).toHaveLength(4);
  });
});
