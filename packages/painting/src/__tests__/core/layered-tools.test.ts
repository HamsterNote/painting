import { createLayeredToolSession } from '../../core/layeredToolSession';
import { FreehandGeometryCache } from '../../geometry/freehandCache';
import { prepareLayeredObjectQuery, queryObjectPoint } from '../../core/layeredObjectQuery';
import { commitLayeredStroke, layeredRect, makeLayeredController } from '../fixtures/layered';

test.each(['line', 'rect', 'ellipse', 'polygon', 'bezier'] as const)(
  '%s previews before up, cancel is reversible and commit is one undo',
  (tool) => {
    const controller = makeLayeredController();
    controller.setTool(tool);
    const session = createLayeredToolSession(controller, () => 'shape');
    session.begin({ x: 20, y: 20 });
    session.update([
      { x: 80, y: 20 },
      { x: 100, y: 80 },
      { x: 20, y: 100 },
    ]);
    expect(controller.getSnapshot('preview').objects).toHaveLength(1);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    session.cancel();
    expect(controller.getSnapshot('preview').objects).toHaveLength(0);
    session.begin({ x: 20, y: 20 });
    session.update([
      { x: 80, y: 20 },
      { x: 100, y: 80 },
      { x: 20, y: 100 },
    ]);
    session.end();
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    controller.undo();
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    controller.redo();
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    session.destroy();
  }
);

test('fast radius sweep erases occluded and transformed objects, with one undo and cancel restore', () => {
  const controller = makeLayeredController([
    layeredRect('lower'),
    { ...layeredRect('upper'), transform: { a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 0 } },
  ]);
  controller.setTool('eraser');
  const session = createLayeredToolSession(controller, () => 'unused');
  session.begin({ x: -40, y: 107 });
  session.update([{ x: 140, y: 107 }]);
  expect(controller.getSnapshot('preview').hiddenIds).toEqual(['lower', 'upper']);
  expect(controller.getSnapshot('document').objects).toHaveLength(2);
  session.cancel();
  expect(controller.getSnapshot('preview').hiddenIds).toEqual([]);
  session.begin({ x: -40, y: 107 });
  session.update([{ x: 140, y: 107 }]);
  session.end();
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toHaveLength(2);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  session.destroy();
});

test.each(['move', 'resize', 'rotate'] as const)(
  'mixed selection %s preserves accepted raw and queries transformed objects',
  (operation) => {
    const controller = makeLayeredController([layeredRect()]);
    commitLayeredStroke(controller, 'ink', 200);
    const ink = controller.getSnapshot('document').objects[1]!;
    controller.setTool('selection');
    controller.setSelection(['rect', ink.objectId]);
    const session = createLayeredToolSession(controller, () => 'unused');
    const before = controller.getSnapshot('document');
    session.begin({ x: 230, y: 50 }, operation);
    session.update([{ x: 240, y: 90 }]);
    expect(controller.getSnapshot('document')).toBe(before);
    expect(controller.getSnapshot('preview').objects).toHaveLength(2);
    session.end();
    const after = controller.getSnapshot('document');
    expect(
      after.objects[1].kind === 'freehand' && ink.kind === 'freehand' && after.objects[1].samples
    ).toBe(ink.kind === 'freehand' && ink.samples);
    expect(after.objects[1].transform).not.toEqual(ink.transform);
    const query = prepareLayeredObjectQuery(after, new FreehandGeometryCache());
    expect(query.ok).toBe(true);
    if (!query.ok) throw new Error(query.error.code);
    const t = after.objects[0].transform;
    const result = queryObjectPoint(
      query.value,
      { x: t.a * 50 + t.c * 50 + t.tx, y: t.b * 50 + t.d * 50 + t.ty },
      0
    );
    expect(result.ok && result.value.some((hit) => hit.objectId === 'rect')).toBe(true);
    controller.undo();
    expect(controller.getSnapshot('document').objects).toEqual(before.objects);
    controller.redo();
    expect(controller.getSnapshot('document').objects).toEqual(after.objects);
    session.destroy();
  }
);

test('stale edits, invalid transforms and duplicate ids leave document and history untouched', () => {
  const controller = makeLayeredController([layeredRect()]);
  const before = controller.getSnapshot('document');
  expect(controller.editObjects({ expectedDocumentRevision: 99, removeIds: ['rect'] }).ok).toBe(
    false
  );
  expect(
    controller.editObjects({ expectedDocumentRevision: 0, upsert: [layeredRect(), layeredRect()] })
      .ok
  ).toBe(false);
  expect(
    controller.editObjects({
      expectedDocumentRevision: 0,
      upsert: [
        {
          ...layeredRect(),
          objectRevision: 2,
          transformRevision: 2,
          transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
        },
      ],
    }).ok
  ).toBe(false);
  expect(controller.getSnapshot('document')).toBe(before);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});

test('lasso uses the complete path for live multiselect and restores selection on cancel', () => {
  const controller = makeLayeredController([
    layeredRect('a'),
    { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 150, ty: 0 } },
  ]);
  controller.setTool('lasso');
  controller.setSelection(['a']);
  const session = createLayeredToolSession(controller, () => 'unused');
  session.begin({ x: -20, y: -20 });
  session.update([
    { x: 300, y: -20 },
    { x: 300, y: 140 },
    { x: -20, y: 140 },
  ]);
  expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
  expect(controller.getSnapshot('preview').path.length).toBeGreaterThan(3);
  session.cancel();
  expect(controller.getSnapshot('selection')).toEqual(['a']);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  session.destroy();
});
