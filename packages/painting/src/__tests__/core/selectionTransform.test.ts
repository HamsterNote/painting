/** @jest-environment node */

import {
  transformSelection,
  type DocumentStrokeTarget,
} from '../../core/selectionTransform';
import type { SelectionIntent } from '../../core/gesture/session';
import { describeDrawingStrokeGeometry } from '../../core/geometry';
import type { DrawingStrokeToolV2, DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

function strokeFor(tool: DrawingStrokeToolV2, id: string = tool): DrawingStrokeV2 {
  const base = {
    schemaVersion: 2 as const,
    id,
    tool,
    points: [{ x: 0, y: 0, pressure: 0.3 }, { x: 20, y: 10, pressure: 0.8 }],
    strokeColor: '#123456',
    strokeWidth: 4,
    dashArray: [2, 3],
  };
  if (tool === 'text') {
    return { ...base, tool, text: 'core', fontSize: 18 };
  }
  if (tool === 'image') {
    return { ...base, tool, src: 'memory://sample', resourceId: 'image-1' };
  }
  if (tool === 'polygon') {
    return { ...base, tool, points: [...base.points, { x: 10, y: 20, pressure: 0.6 }] };
  }
  if (tool === 'bezier') {
    return { ...base, tool, points: [{ x: 0, y: 0 }, { x: 5, y: 20 }, { x: 15, y: -10 }, { x: 20, y: 10 }] };
  }
  return base as DrawingStrokeV2;
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

function target(index: number, stroke: DrawingStrokeV2): DocumentStrokeTarget {
  return { index, expectedId: stroke.id, expectedTool: stroke.tool };
}

const move: SelectionIntent = { kind: 'move', delta: { x: 3, y: -4 } };
const rotate: SelectionIntent = { kind: 'rotate', pivot: { x: 0, y: 0 }, deltaRad: Math.PI / 2 };
const scale: SelectionIntent = {
  kind: 'resize',
  anchor: { x: 0, y: 0 },
  axis: { x: 1, y: 1 },
  scale: { x: 2, y: 2 },
};
const uniformScale = {
  kind: 'uniform-scale' as const,
  anchor: { x: 0, y: 0 },
  scale: 2,
};

describe('core/selectionTransform', () => {
  it.each(['pen', 'line', 'rect', 'ellipse', 'polygon', 'bezier', 'text', 'image'] as const)(
    'keeps %s in its V2 representation under move, rotate, and uniform scale',
    (tool) => {
      const stroke = strokeFor(tool);
      const input = documentWith(stroke);

      for (const intent of [move, rotate, uniformScale]) {
        const result = transformSelection(input, [target(0, stroke)], intent);
        const next = result.replacements[0]?.stroke;
        expect(result.diagnostics).toEqual([]);
        expect(next).toBeDefined();
        expect(next?.tool).toBe(tool);
        expect(next?.schemaVersion).toBe(2);
        expect(next?.points).not.toBe(stroke.points);
        expect(next?.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
        expect(next && describeDrawingStrokeGeometry(next)).not.toBeNull();
      }
      expect(input).toEqual(documentWith(stroke));
    }
  );

  it.each(['rect', 'ellipse', 'text', 'image'] as const)(
    'rotates %s by its center and rotationRad without rotating box endpoints twice',
    (tool) => {
      const stroke = { ...strokeFor(tool), rotationRad: 0.25 } as DrawingStrokeV2;
      const result = transformSelection(documentWith(stroke), [target(0, stroke)], rotate);
      const next = result.replacements[0].stroke;

      expect(next.points).toEqual([
        { x: -15, y: 5, pressure: 0.3 },
        { x: 5, y: 15, pressure: 0.8 },
      ]);
      expect(next.rotationRad).toBeCloseTo(0.25 + Math.PI / 2);
    }
  );

  it('rejects non-uniform, non-finite, and too-small scales without schema or state replacements', () => {
    const stroke = strokeFor('rect');
    const document = documentWith(stroke);
    const nonUniform = transformSelection(document, [target(0, stroke)], {
      ...scale,
      scale: { x: 2, y: 3 },
    });
    const invalid = transformSelection(document, [target(0, stroke)], {
      ...scale,
      scale: { x: Number.NaN, y: Number.NaN },
    });
    const tooSmall = transformSelection(document, [target(0, stroke)], {
      ...scale,
      scale: { x: 0, y: 0 },
    });

    expect(nonUniform).toEqual({ replacements: [], diagnostics: [{ type: 'non-uniform-selection-scale', scale: { x: 2, y: 3 } }] });
    expect(invalid.replacements).toEqual([]);
    expect(invalid.diagnostics).toEqual([{ type: 'invalid-selection-intent' }]);
    expect(tooSmall.diagnostics).toEqual([{ type: 'invalid-selection-scale', scale: 0 }]);
    expect(document).toEqual(documentWith(stroke));
  });

  it('is atomic for stale or duplicate targets and reports identity transforms as no-ops', () => {
    const first = strokeFor('pen', 'first');
    const second = strokeFor('line', 'second');
    const document = documentWith(first, second);
    const stale = transformSelection(document, [target(0, first), { index: 1, expectedId: 'stale' }], move);
    const duplicate = transformSelection(document, [target(0, first), target(0, first)], move);
    const identity = transformSelection(document, [target(0, first)], {
      kind: 'move',
      delta: { x: 0, y: 0 },
    });

    expect(stale).toEqual({ replacements: [], diagnostics: [{ type: 'selection-target-mismatch', target: { index: 1, expectedId: 'stale' } }] });
    expect(duplicate).toEqual({ replacements: [], diagnostics: [{ type: 'duplicate-selection-target', index: 0 }] });
    expect(identity).toEqual({ replacements: [], diagnostics: [{ type: 'selection-transform-noop' }] });
  });

  it('rejects a fallback text box scale that cannot be represented without schema expansion', () => {
    const degenerate: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'text',
      tool: 'text',
      points: [{ x: 1, y: 2 }],
      text: 'fallback',
      fontSize: 16,
    };
    const document = documentWith(degenerate);
    const result = transformSelection(document, [target(0, degenerate)], scale);

    expect(result).toEqual({
      replacements: [],
      diagnostics: [{ type: 'invalid-selection-stroke', target: target(0, degenerate) }],
    });
    expect(document).toEqual(documentWith(degenerate));
  });

  it('uses the scalar uniform-scale intent without changing V2 styles or pressure', () => {
    const stroke = strokeFor('text');
    const result = transformSelection(documentWith(stroke), [target(0, stroke)], uniformScale);

    expect(result.diagnostics).toEqual([]);
    expect(result.replacements[0].stroke.points).toEqual([
      { x: 0, y: 0, pressure: 0.3 },
      { x: 40, y: 20, pressure: 0.8 },
    ]);
    expect(result.replacements[0].stroke).toMatchObject({
      fontSize: 18,
      strokeColor: '#123456',
      strokeWidth: 4,
      dashArray: [2, 3],
    });
  });

  it('keeps scalar uniform-scale atomic for stale, duplicate, and invalid target groups', () => {
    const first = strokeFor('pen', 'first');
    const second = strokeFor('line', 'second');
    const document = documentWith(first, second);
    const valid = transformSelection(document, [target(0, first), target(1, second)], uniformScale);

    expect(valid.diagnostics).toEqual([]);
    expect(valid.replacements).toHaveLength(2);
    expect(valid.replacements.map(({ stroke }) => stroke.id)).toEqual(['first', 'second']);
    expect(transformSelection(document, [target(0, first), { index: 1, expectedId: 'stale' }], uniformScale))
      .toEqual({ replacements: [], diagnostics: [{ type: 'selection-target-mismatch', target: { index: 1, expectedId: 'stale' } }] });
    expect(transformSelection(document, [target(0, first), target(0, first)], uniformScale))
      .toEqual({ replacements: [], diagnostics: [{ type: 'duplicate-selection-target', index: 0 }] });
    expect(transformSelection(document, [target(0, first), target(1, second)], {
      ...uniformScale,
      scale: Number.NaN,
    })).toEqual({ replacements: [], diagnostics: [{ type: 'invalid-selection-intent' }] });
    expect(document).toEqual(documentWith(first, second));
  });
});
