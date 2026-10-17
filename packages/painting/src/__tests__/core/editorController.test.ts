/** @jest-environment node */

import {
  addEditorControllerToolVertex,
  beginEditorControllerGesture,
  beginEditorControllerToolPointer,
  commitEditorControllerCandidate,
  commitEditorControllerDocumentCommand,
  commitEditorControllerEraser,
  createEditorControllerState,
  finishEditorControllerBezier,
  finishEditorControllerPolygon,
  finishEditorControllerToolPointer,
  moveEditorControllerToolPointer,
  queryEditorControllerEraser,
  queryEditorControllerDrawingFrameEraser,
  queryEditorControllerDrawingFrameLasso,
  queryEditorControllerLasso,
  reduceEditorControllerGesture,
  redoEditorController,
  setEditorControllerSelection,
  setEditorControllerTool,
  undoEditorController,
} from '../../core/editorController';
import { undoEditorInteraction } from '../../core/editorInteraction';
import { createDrawingFrame, createPreparedDrawingSpatialIndex } from '../../core/drawingFrame';
import { prepareDrawingDocument } from '../../core/preparedDocument';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';
import type { NormalizedPointerInput } from '../../core/input';

function pen(id: string, x: number, y = 0): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'pen',
    points: [{ x, y }, { x: x + 2, y }],
  };
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

function controller(document: DrawingValueV2, tool: 'pen' | 'line' | 'polygon' | 'bezier' = 'pen') {
  return createEditorControllerState(document, {
    tool,
    createId: (strokeTool) => `created-${strokeTool}`,
    toolStyle: { strokeColor: '#123456', dashArray: [2, 4] },
  });
}

function target(index: number, stroke: DrawingStrokeV2) {
  return { index, expectedId: stroke.id, expectedTool: stroke.tool } as const;
}

function drawingFrame(document: DrawingValueV2) {
  const prepared = prepareDrawingDocument(document);
  return createDrawingFrame({
    prepared,
    spatialIndex: createPreparedDrawingSpatialIndex(prepared),
    viewport: { scale: 1, tx: 0, ty: 0 },
    layoutSize: { width: 100, height: 100 },
  })!;
}

function input(
  phase: NormalizedPointerInput['phase'],
  targetRole: NormalizedPointerInput['targetRole'],
  x = 0,
  y = 0
): NormalizedPointerInput {
  return {
    phase,
    targetRole,
    pointerId: 'gesture',
    device: 'pen',
    screen: { x, y },
    timestamp: 1,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
  };
}

describe('core/editorController', () => {
  it.each(['pen', 'line'] as const)('keeps a %s candidate out of history until explicitly committed, then supports undo', (tool) => {
    const initial = controller(documentWith(), tool);
    const begun = beginEditorControllerToolPointer(initial, { x: 1, y: 2 }).state;
    const moved = moveEditorControllerToolPointer(begun, { x: 4, y: 3 }).state;
    const finished = finishEditorControllerToolPointer(moved, { x: 8, y: 4 });
    const committed = commitEditorControllerCandidate(finished.state);
    const undone = undoEditorInteraction(committed.state.interaction).state;

    expect(finished.state.strokeCandidate).toMatchObject({ tool, id: `created-${tool}` });
    expect(finished.state.interaction.runtime.documentState.document.strokes).toEqual([]);
    expect(committed.state.interaction.runtime.documentState.document.strokes).toMatchObject([{ tool }]);
    expect(committed.state.interaction.runtime.undoStack).toHaveLength(1);
    expect(undone.runtime.documentState.document.strokes).toEqual([]);
  });

  it('builds polygon and Bézier candidates through explicit vertices before a single append commit', () => {
    let polygon = controller(documentWith(), 'polygon');
    for (const point of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]) {
      polygon = addEditorControllerToolVertex(polygon, point).state;
    }
    const polygonFinished = finishEditorControllerPolygon(polygon);
    const polygonCommitted = commitEditorControllerCandidate(polygonFinished.state);

    let bezier = controller(documentWith(), 'bezier');
    for (const point of [{ x: 0, y: 0 }, { x: 2, y: 8 }, { x: 8, y: 8 }, { x: 10, y: 0 }]) {
      bezier = addEditorControllerToolVertex(bezier, point).state;
    }
    const bezierFinished = finishEditorControllerBezier(bezier);

    expect(polygonFinished.state.strokeCandidate?.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]);
    expect(polygonCommitted.state.interaction.runtime.undoStack).toHaveLength(1);
    expect(bezierFinished.state.strokeCandidate).toMatchObject({ tool: 'bezier', id: 'created-bezier' });
    expect(bezierFinished.state.interaction.runtime.documentState.document.strokes).toEqual([]);
  });

  it('returns text/image/query handoffs and clears candidates on tool switches without history', () => {
    const initial = controller(documentWith());
    const text = setEditorControllerTool(initial, 'text');
    const image = setEditorControllerTool(text.state, 'image');
    const eraser = setEditorControllerTool(image.state, 'eraser');
    const lasso = setEditorControllerTool(eraser.state, 'lasso');

    expect(text.diagnostics).toEqual([{ type: 'requires-text-session' }]);
    expect(image.diagnostics).toEqual([{ type: 'requires-resource-import' }]);
    expect(eraser.diagnostics).toEqual([{ type: 'requires-query', tool: 'eraser' }]);
    expect(lasso.diagnostics).toEqual([{ type: 'requires-query', tool: 'lasso' }]);
    expect(lasso.state.interaction.runtime.undoStack).toEqual([]);
    expect(lasso.state.strokeCandidate).toBeUndefined();
  });

  it('queries lasso into stable duplicate-safe targets without writing history', () => {
    const first = pen('duplicate', 1);
    const second = { ...pen('duplicate', 20), tool: 'line' as const };
    const state = controller(documentWith(first, second));
    const queried = queryEditorControllerLasso(state, [
      { x: -2, y: -2 },
      { x: 8, y: -2 },
      { x: 8, y: 4 },
      { x: -2, y: 4 },
    ]);

    expect(queried.diagnostics).toEqual([]);
    expect(queried.state.selectionTargets).toEqual([target(0, first)]);
    expect(queried.state.interaction.selectionTargets).toEqual([target(0, first)]);
    expect(queried.state.interaction.runtime.undoStack).toEqual([]);
  });

  it('queries an eraser track then removes its topmost hit in one history commit and supports undo', () => {
    const bottom = pen('bottom', 0);
    const top = pen('top', 0);
    const state = controller(documentWith(bottom, top));
    const queried = queryEditorControllerEraser(state, [{ x: 1, y: 0 }, { x: 1, y: 0 }], 1, {
      topmostOnly: true,
    });
    const committed = commitEditorControllerEraser(queried.state);
    const undone = undoEditorInteraction(committed.state.interaction).state;

    expect(queried.state.selectionTargets).toEqual([target(1, top)]);
    expect(queried.state.interaction.runtime.undoStack).toEqual([]);
    expect(committed.state.interaction.runtime.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['bottom']);
    expect(committed.state.interaction.runtime.undoStack).toHaveLength(1);
    expect(undone.runtime.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['bottom', 'top']);
  });

  it('keeps stale candidate commits, empty eraser commits, and invalid query input out of history', () => {
    const finished = finishEditorControllerToolPointer(
      beginEditorControllerToolPointer(controller(documentWith()), { x: 0, y: 0 }).state,
      { x: 4, y: 0 }
    ).state;
    const stale = commitEditorControllerCandidate(finished, 1);
    const emptyErase = commitEditorControllerEraser(controller(documentWith()));
    const invalidLasso = queryEditorControllerLasso(controller(documentWith()), [{ x: 0, y: 0 }]);

    expect(stale.state.interaction).toBe(finished.interaction);
    expect(stale.state.interaction.runtime).toBe(finished.interaction.runtime);
    expect(stale.diagnostics).toEqual([{ type: 'revision-mismatch', expectedRevision: 1, actualRevision: 0 }]);
    expect(emptyErase.diagnostics).toEqual([{ type: 'no-eraser-targets' }]);
    expect(emptyErase.state.interaction.runtime.undoStack).toEqual([]);
    expect(invalidLasso.diagnostics).toEqual([{ type: 'invalid-lasso-polygon' }]);
    expect(invalidLasso.state.interaction.runtime.undoStack).toEqual([]);
  });

  it('accepts frame-only lasso/eraser targets only when frame revision and snapshot identity match runtime', () => {
    const bottom = pen('duplicate', 0);
    const top = pen('duplicate', 0);
    const document = documentWith(bottom, top);
    const frame = drawingFrame(document);
    const state = controller(document);
    const lasso = queryEditorControllerDrawingFrameLasso(state, frame, 0, [
      { x: -1, y: -1 }, { x: 4, y: -1 }, { x: 4, y: 1 }, { x: -1, y: 1 },
    ]);
    const eraser = queryEditorControllerDrawingFrameEraser(state, frame, 0, [{ x: 1, y: 0 }], 1, { topmostOnly: true });
    const stale = queryEditorControllerDrawingFrameLasso(state, frame, 1, [
      { x: -1, y: -1 }, { x: 4, y: -1 }, { x: 4, y: 1 }, { x: -1, y: 1 },
    ]);
    const foreignFrame = drawingFrame(documentWith(pen('other', 0)));
    const foreign = queryEditorControllerDrawingFrameEraser(state, foreignFrame, 0, [{ x: 1, y: 0 }], 1);

    expect(lasso.diagnostics).toEqual([]);
    expect(lasso.state.selectionTargets).toEqual([target(0, bottom), target(1, top)]);
    expect(eraser.state.selectionTargets).toEqual([target(1, top)]);
    expect(stale.diagnostics).toEqual([{ type: 'frame-revision-mismatch', frameRevision: 1, expectedRevision: 0 }]);
    expect(stale.state.selectionTargets).toEqual([]);
    expect(foreign.diagnostics).toEqual([{ type: 'frame-document-identity-mismatch' }]);
    expect(foreign.state.selectionTargets).toEqual([]);
  });

  it('only proxies normalized gesture input through editorInteraction and does not mutate controller inputs', () => {
    const document = documentWith(pen('first', 1));
    const point = { x: 2, y: 3 };
    const selectionDescriptor = {
      kind: 'move' as const,
      box: { center: { x: 1, y: 0 }, width: 4, height: 4, rotationRad: 0 },
    };
    const configured = setEditorControllerSelection(
      controller(document),
      [target(0, document.strokes[0])],
      selectionDescriptor
    ).state;
    const pointer = input('down', 'selection', 1, 0);
    const before = JSON.parse(JSON.stringify(pointer));
    const begun = beginEditorControllerGesture(configured).state;
    const down = reduceEditorControllerGesture(begun, pointer).state;
    const reduced = reduceEditorControllerGesture(down, input('up', 'selection', 5, 0));
    document.strokes[0].points[0].x = 99;
    point.x = 99;
    selectionDescriptor.box.center.x = 99;

    expect(reduced.diagnostics).toEqual([]);
    expect(reduced.state.interaction.runtime.documentState.document.strokes[0].points).toEqual([
      { x: 5, y: 0 },
      { x: 7, y: 0 },
    ]);
    expect(reduced.state.interaction.runtime.undoStack).toHaveLength(1);
    expect(pointer).toEqual(before);
    expect(configured.interaction.runtime.documentState.document.strokes[0].points[0].x).toBe(1);
    expect(configured.interaction.selectionDescriptor?.box.center.x).toBe(1);
  });

  it('clears selection for text removal and clear, including eraser undo/redo lifecycle', () => {
    const text: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'text', tool: 'text', text: 'hello', fontSize: 16,
      points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
    };
    const other = pen('other', 30);
    const textSelected = setEditorControllerSelection(controller(documentWith(text, other)), [target(0, text)]).state;
    const textRemoved = commitEditorControllerDocumentCommand(textSelected, {
      type: 'remove-strokes', expectedRevision: 0, targets: [target(0, text)],
    }).state;
    const clearSelected = setEditorControllerSelection(controller(documentWith(text, other)), [target(0, text), target(1, other)]).state;
    const cleared = commitEditorControllerDocumentCommand(clearSelected, {
      type: 'clear-strokes', expectedRevision: 0,
    }).state;
    const eraseQueried = queryEditorControllerEraser(controller(documentWith(other)), [{ x: 31, y: 0 }], 2).state;
    const erased = commitEditorControllerEraser(eraseQueried).state;
    const undone = undoEditorController(erased).state;
    const redone = redoEditorController(undone).state;

    for (const state of [textRemoved, cleared, erased, undone, redone]) {
      expect(state.selectionTargets).toEqual([]);
      expect(state.interaction.selectionTargets).toEqual([]);
      expect(state.interaction.selectionDescriptor).toBeUndefined();
      expect(state.interaction.selectionPreview).toBeUndefined();
    }
    expect(textRemoved.interaction.runtime.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['other']);
    expect(cleared.interaction.runtime.documentState.document.strokes).toEqual([]);
    expect(erased.interaction.runtime.documentState.document.strokes).toEqual([]);
    expect(undone.interaction.runtime.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['other']);
    expect(redone.interaction.runtime.documentState.document.strokes).toEqual([]);
  });
});
