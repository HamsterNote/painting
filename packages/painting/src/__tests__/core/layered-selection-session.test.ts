import { createLayeredToolSession } from '../../core/layeredToolSession';
import {
  deriveLayeredSelectionGeometry,
  hitLayeredSelectionGeometry,
} from '../../core/layeredSelectionGeometry';
import { applyAffine } from '../../geometry/affine';
import { layeredRect, makeLayeredController } from '../fixtures/layered';

function setup(multi = false) {
  const controller = makeLayeredController(
    multi
      ? [
          layeredRect('a'),
          { ...layeredRect('b'), transform: { a: 0, b: 1, c: -1, d: 0, tx: 300, ty: 0 } },
        ]
      : [layeredRect('a')]
  );
  controller.setTool('selection');
  controller.setSelection(multi ? ['a', 'b'] : ['a']);
  const tool = createLayeredToolSession(controller, () => 'new');
  return { controller, tool };
}
function rotation(s: ReturnType<typeof setup>, degrees: number, end = true) {
  const geometry = deriveLayeredSelectionGeometry(s.controller)!;
  const start = applyAffine(geometry.localToHost, geometry.rotate)!;
  const center = applyAffine(geometry.localToHost, {
    x: (geometry.frame.minX + geometry.frame.maxX) / 2,
    y: (geometry.frame.minY + geometry.frame.maxY) / 2,
  })!;
  const angle = (degrees * Math.PI) / 180;
  s.tool.begin(start);
  s.tool.update([
    {
      x: center.x + Math.cos(angle) * (start.x - center.x) - Math.sin(angle) * (start.y - center.y),
      y: center.y + Math.sin(angle) * (start.x - center.x) + Math.cos(angle) * (start.y - center.y),
    },
  ]);
  if (end) s.tool.end();
}
function angle(s: ReturnType<typeof setup>) {
  const g = deriveLayeredSelectionGeometry(s.controller)!;
  return (
    (Math.atan2(g.corners[1].y - g.corners[0].y, g.corners[1].x - g.corners[0].x) * 180) / Math.PI
  );
}

test.each([false, true])(
  'consecutive rotations, move and scale retain session direction (multi=%s)',
  (multi) => {
    const s = setup(multi);
    const document = s.controller.getSnapshot('document');
    const widths = deriveLayeredSelectionGeometry(s.controller)!.frame;
    rotation(s, 30, false);
    expect(angle(s)).toBeCloseTo(30);
    expect(s.controller.getSnapshot('document')).toBe(document);
    const observed: number[] = [];
    const stop = s.controller.subscribe('document', () => observed.push(angle(s)));
    s.tool.end();
    stop();
    expect(observed).toEqual([expect.closeTo(30)]);
    rotation(s, 20);
    expect(angle(s)).toBeCloseTo(50);
    let g = deriveLayeredSelectionGeometry(s.controller)!;
    expect(g.frame.maxX - g.frame.minX).toBeCloseTo(widths.maxX - widths.minX);
    const center = {
      x: (g.corners[0].x + g.corners[2].x) / 2,
      y: (g.corners[0].y + g.corners[2].y) / 2,
    };
    s.tool.begin(center);
    s.tool.update([{ x: center.x + 20, y: center.y + 15 }]);
    s.tool.end();
    expect(angle(s)).toBeCloseTo(50);
    g = deriveLayeredSelectionGeometry(s.controller)!;
    const c = {
      x: (g.corners[0].x + g.corners[2].x) / 2,
      y: (g.corners[0].y + g.corners[2].y) / 2,
    };
    s.tool.begin(g.corners[2]);
    s.tool.update([
      { x: c.x + (g.corners[2].x - c.x) * 1.5, y: c.y + (g.corners[2].y - c.y) * 1.5 },
    ]);
    s.tool.end();
    expect(angle(s)).toBeCloseTo(50);
    expect(
      deriveLayeredSelectionGeometry(s.controller)!.frame.maxX -
        deriveLayeredSelectionGeometry(s.controller)!.frame.minX
    ).toBeCloseTo((widths.maxX - widths.minX) * 1.5);
    expect(s.controller.getSnapshot('document').documentRevision).toBe(4);
    expect(JSON.stringify(s.controller.getSnapshot('document'))).not.toContain('sessionId');
    for (let i = 0; i < 4; i++) s.controller.undo();
    expect(s.controller.getSnapshot('document').objects).toEqual(document.objects);
    expect(s.controller.getSnapshot('history').canUndo).toBe(false);
  }
);

test('set membership and viewport retain orientation; reselect, changed set and history reset it', () => {
  const s = setup(true);
  rotation(s, 30);
  const frame = s.controller.getSnapshot('selectionFrame');
  s.controller.setSelection(['b', 'a']);
  expect(s.controller.getSnapshot('selectionFrame')).toBe(frame);
  s.controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: 37, ty: 49 },
  });
  expect(angle(s)).toBeCloseTo(30);
  s.controller.setSelection([]);
  s.controller.setSelection(['a', 'b']);
  expect(angle(s)).toBeCloseTo(0);
  expect(s.controller.getSnapshot('document').documentRevision).toBe(1);
  s.controller.undo();
  expect(angle(s)).toBeCloseTo(0);
  s.controller.redo();
  expect(angle(s)).toBeCloseTo(0);
  s.controller.setSelection(['a']);
  expect(s.controller.getSnapshot('selectionFrame')!.ids).toEqual(['a']);
});

test('cancel restores the previous frame; no-op click and late updates never commit', () => {
  const s = setup();
  rotation(s, 30);
  const before = s.controller.getSnapshot('document');
  rotation(s, 30, false);
  expect(angle(s)).toBeCloseTo(60);
  s.tool.cancel();
  s.tool.update([{ x: 200, y: 200 }]);
  s.tool.end();
  expect(angle(s)).toBeCloseTo(30);
  expect(s.controller.getSnapshot('document')).toBe(before);
  const center = applyAffine(s.controller.getSnapshot('selectionFrame')!.transform, {
    x: 50,
    y: 50,
  })!;
  s.tool.begin(center);
  s.tool.end();
  expect(s.controller.getSnapshot('document')).toBe(before);
  rotation(s, 20);
  expect(angle(s)).toBeCloseTo(50);
});

test('continuous rotation unwraps multiple coalesced samples across pi', () => {
  const s = setup();
  const start = deriveLayeredSelectionGeometry(s.controller)!.rotate;
  s.tool.begin(start);
  s.tool.update(
    [170, 190, 350, 370].map((degrees) => {
      const a = (degrees * Math.PI) / 180;
      return { x: 50 + Math.sin(a) * 71, y: 50 - Math.cos(a) * 71 };
    })
  );
  const frame = s.controller.getSnapshot('preview').selectionFrame!;
  expect(frame.transform.a).toBeCloseTo(Math.cos((10 * Math.PI) / 180));
  expect(frame.transform.b).toBeCloseTo(Math.sin((10 * Math.PI) / 180));
  s.tool.end();
  expect(angle(s)).toBeCloseTo(10);
});

test.each([0, 30, 45, 90])(
  'local geometry at %s degrees preserves bands/handles and rejects envelope false positives',
  (degrees) => {
    const s = setup();
    rotation(s, degrees);
    const g = deriveLayeredSelectionGeometry(s.controller)!;
    const map = (x: number, y: number) => applyAffine(g.localToHost, { x, y })!;
    expect(hitLayeredSelectionGeometry(g, map(g.frame.minX + 20, g.frame.minY + 30))).toBe('move');
    expect(hitLayeredSelectionGeometry(g, map(g.region.minX, g.frame.minY + 20))).toBe('move');
    expect(hitLayeredSelectionGeometry(g, map(g.frame.minX + 20, g.frame.minY - 15))).toBe('move');
    expect(hitLayeredSelectionGeometry(g, map(g.region.minX + 0.001, g.frame.minY + 20))).toBe(
      'move'
    );
    expect(
      hitLayeredSelectionGeometry(g, map(g.region.minX - 0.001, g.frame.minY + 20))
    ).toBeNull();
    expect(hitLayeredSelectionGeometry(g, map(g.frame.maxX, g.frame.maxY))).toBe('resize');
    expect(hitLayeredSelectionGeometry(g, applyAffine(g.localToHost, g.rotate)!)).toBe('rotate');
    const regionCorners = [
      map(g.region.minX, g.region.minY),
      map(g.region.maxX, g.region.minY),
      map(g.region.maxX, g.region.maxY),
      map(g.region.minX, g.region.maxY),
    ];
    const falseHits =
      degrees === 30 || degrees === 45
        ? [
            {
              x: Math.min(...regionCorners.map((p) => p.x)) + 0.1,
              y: Math.min(...regionCorners.map((p) => p.y)) + 0.1,
            },
          ]
        : [];
    for (const falseHit of falseHits) expect(hitLayeredSelectionGeometry(g, falseHit)).toBeNull();
    const staleHandles = degrees === 30 || degrees === 45 ? [{ x: 50, y: -21 }] : [];
    for (const stale of staleHandles)
      expect(hitLayeredSelectionGeometry(g, stale)).not.toBe('rotate');
    expect(hitLayeredSelectionGeometry(g, { x: NaN, y: 0 })).toBeNull();
  }
);

test('external edits and deletion invalidate preview and stale session; remount starts orthogonal', () => {
  const s = setup();
  rotation(s, 30);
  rotation(s, 30, false);
  const original = s.controller.getSnapshot('document').objects[0];
  s.controller.editObjects({
    expectedDocumentRevision: 1,
    upsert: [{ ...original, objectRevision: original.objectRevision + 1 }],
  });
  expect(angle(s)).toBeCloseTo(0);
  s.tool.end();
  expect(s.controller.getSnapshot('document').documentRevision).toBe(2);
  rotation(s, 20);
  s.tool.destroy();
  expect(angle(s)).toBeCloseTo(0);
  s.controller.editObjects({ expectedDocumentRevision: 3, removeIds: ['a'] });
  expect(deriveLayeredSelectionGeometry(s.controller)).toBeNull();
});

test('pen detection alone does not cancel an owned selection rotation', () => {
  const s = setup();
  rotation(s, 30, false);
  s.controller.recordPenDown();
  expect(angle(s)).toBeCloseTo(30);
  expect(s.controller.getSnapshot('preview').objects).toHaveLength(1);
  s.tool.end();
  expect(angle(s)).toBeCloseTo(30);
  expect(s.controller.getSnapshot('document').documentRevision).toBe(1);
});
