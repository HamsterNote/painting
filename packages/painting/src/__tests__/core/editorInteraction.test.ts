/** @jest-environment node */

import {
  applyEditorRuntimeCommand,
  beginEditorGesture,
  commitEditorInteractionCommand,
  commitEditorInteractionDocument,
  createEditorInteractionState,
  reduceEditorGesture,
  redoEditorInteraction,
  setEditorInteractionTool,
  setEditorSelection,
  selectionIntentToWorld,
  undoEditorInteraction,
} from '../../core';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';
import type { NormalizedPointerInput } from '../../core/input';

function pen(id: string, x = 0): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'pen',
    points: [{ x, y: 0, pressure: 0.5 }],
  };
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

function input(
  phase: NormalizedPointerInput['phase'],
  targetRole: NormalizedPointerInput['targetRole'],
  x: number,
  y: number,
  overrides: Partial<NormalizedPointerInput> = {}
): NormalizedPointerInput {
  return {
    phase,
    targetRole,
    pointerId: 'pointer',
    device: 'pen',
    screen: { x, y },
    timestamp: 10,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    ...overrides,
  };
}

function target(index: number, stroke: DrawingStrokeV2) {
  return { index, expectedId: stroke.id, expectedTool: stroke.tool } as const;
}

describe('core/editorInteraction', () => {
  it('commits pen down/move/up once into runtime history and supports undo/redo', () => {
    const initial = createEditorInteractionState(documentWith());
    const begun = beginEditorGesture(initial).state;
    const down = reduceEditorGesture(begun, input('down', 'paper', 1, 2)).state;
    const move = reduceEditorGesture(down, input('move', 'paper', 4, 6)).state;
    const completed = reduceEditorGesture(move, input('up', 'paper', 7, 8)).state;
    const undone = undoEditorInteraction(completed).state;
    const redone = redoEditorInteraction(undone).state;

    expect(completed.runtime.documentState.document.strokes).toMatchObject([
      { tool: 'pen', points: [{ x: 1, y: 2 }, { x: 4, y: 6 }, { x: 7, y: 8 }] },
    ]);
    expect(completed.runtime.undoStack).toHaveLength(1);
    expect(completed.activeGesture).toBeUndefined();
    expect(undone.runtime.documentState.document.strokes).toEqual([]);
    expect(redone.runtime.documentState.document.strokes).toMatchObject([{ tool: 'pen' }]);
  });

  it('updates single and two-touch navigation viewport previews without document history', () => {
    const single = createEditorInteractionState(documentWith(), {
      interactionPolicy: { singleTouch: 'pan' },
    });
    const singleActive = reduceEditorGesture(
      beginEditorGesture(single).state,
      input('down', 'paper', 10, 10, { device: 'touch', pointerId: 'one' })
    ).state;
    const singleMoved = reduceEditorGesture(
      singleActive,
      input('move', 'paper', 25, 4, { device: 'touch', pointerId: 'one' })
    ).state;
    const singleCompleted = reduceEditorGesture(
      singleMoved,
      input('up', 'paper', 25, 4, { device: 'touch', pointerId: 'one' })
    ).state;

    const dual = createEditorInteractionState(documentWith(), {
      interactionPolicy: { singleTouch: 'pan', twoTouch: 'pan-zoom' },
    });
    const dualBegun = beginEditorGesture(dual).state;
    const dualFirst = reduceEditorGesture(
      dualBegun,
      input('down', 'paper', 0, 0, { device: 'touch', pointerId: 'one' })
    ).state;
    const dualSecond = reduceEditorGesture(
      dualFirst,
      input('down', 'paper', 10, 0, { device: 'touch', pointerId: 'two' })
    ).state;
    const dualMoved = reduceEditorGesture(
      dualSecond,
      input('move', 'paper', 20, 0, { device: 'touch', pointerId: 'two' })
    ).state;

    expect(singleMoved.viewport).toEqual({ scale: 1, tx: 15, ty: -6 });
    expect(singleCompleted.runtime).toBe(single.runtime);
    expect(singleCompleted.runtime.undoStack).toEqual([]);
    expect(dualMoved.viewport).toMatchObject({ scale: 2 });
    expect(dualMoved.runtime.undoStack).toEqual([]);
  });

  it('cancels a drawing without a runtime commit', () => {
    const begun = beginEditorGesture(createEditorInteractionState(documentWith())).state;
    const down = reduceEditorGesture(begun, input('down', 'paper', 0, 0)).state;
    const drawing = reduceEditorGesture(down, input('move', 'paper', 10, 0)).state;
    const cancelled = reduceEditorGesture(drawing, input('cancel', 'paper', 10, 0));

    expect(cancelled.state.runtime.documentState.document.strokes).toEqual([]);
    expect(cancelled.state.runtime.undoStack).toEqual([]);
    expect(cancelled.state.activeGesture).toBeUndefined();
    expect(cancelled.diagnostics).toEqual([]);
  });

  it('commits a selection transform once and diagnoses missing targets or non-uniform resize', () => {
    const first = pen('first', 2);
    const descriptor = {
      kind: 'move' as const,
      box: { center: { x: 2, y: 0 }, width: 4, height: 4, rotationRad: 0 },
    };
    const configured = setEditorSelection(
      createEditorInteractionState(documentWith(first)),
      [target(0, first)],
      descriptor
    ).state;
    const down = reduceEditorGesture(beginEditorGesture(configured).state, input('down', 'selection', 2, 0)).state;
    const moved = reduceEditorGesture(down, input('move', 'selection', 8, 3)).state;
    const completed = reduceEditorGesture(moved, input('up', 'selection', 8, 3)).state;
    const missingTargets = reduceEditorGesture(
      reduceEditorGesture(
        beginEditorGesture(
          setEditorSelection(createEditorInteractionState(documentWith(first)), [], descriptor).state
        ).state,
        input('down', 'selection', 2, 0)
      ).state,
      input('up', 'selection', 8, 3)
    );
    const resizeDescriptor = {
      kind: 'resize' as const,
      box: { center: { x: 10, y: 10 }, width: 20, height: 10, rotationRad: 0 },
      anchor: { x: 0, y: 5 },
      axis: { x: 1 as const, y: 1 as const },
    };
    const resize = reduceEditorGesture(
      reduceEditorGesture(
        beginEditorGesture(setEditorSelection(configured, [target(0, first)], resizeDescriptor).state).state,
        input('down', 'selection', 10, 10)
      ).state,
      input('up', 'selection', -10, -10)
    );

    expect(completed.runtime.documentState.document.strokes[0].points).toEqual([{ x: 8, y: 3, pressure: 0.5 }]);
    expect(completed.runtime.undoStack).toHaveLength(1);
    expect(missingTargets.state.runtime.undoStack).toEqual([]);
    expect(missingTargets.diagnostics).toEqual([{ type: 'no-selection-targets' }]);
    expect(resize.state.runtime.undoStack).toEqual([]);
    expect(resize.diagnostics).toEqual([
      { type: 'non-uniform-selection-scale', scale: { x: 0.05, y: 0.1 } },
    ]);
  });

  it('rejects stale document effects rather than overwriting an externally advanced runtime', () => {
    const first = pen('first');
    const started = reduceEditorGesture(
      beginEditorGesture(createEditorInteractionState(documentWith(first))).state,
      input('down', 'paper', 0, 0)
    ).state;
    const externallyAdvanced = {
      ...started,
      runtime: applyEditorRuntimeCommand(started.runtime, {
        type: 'append-stroke',
        expectedRevision: 0,
        stroke: pen('external'),
      }).state,
    };
    const completed = reduceEditorGesture(externallyAdvanced, input('up', 'paper', 10, 0));

    expect(completed.state.runtime.documentState.document.strokes.map((stroke) => stroke.id)).toEqual([
      'first',
      'external',
    ]);
    expect(completed.state.runtime.undoStack).toHaveLength(1);
    expect(completed.diagnostics).toEqual([
      { type: 'stale-gesture-revision', expectedRevision: 0, actualRevision: 1 },
    ]);
  });

  it('keeps unsupported tools out of history and rejects undo/redo while a gesture is active', () => {
    const unsupported = beginEditorGesture(
      setEditorInteractionTool(createEditorInteractionState(documentWith()), 'line').state
    ).state;
    const unsupportedCompleted = reduceEditorGesture(
      reduceEditorGesture(unsupported, input('down', 'paper', 0, 0)).state,
      input('up', 'paper', 10, 0)
    ).state;
    const active = beginEditorGesture(createEditorInteractionState(documentWith())).state;

    expect(unsupportedCompleted.runtime.undoStack).toEqual([]);
    expect(unsupportedCompleted.runtime.documentState.document.strokes).toEqual([]);
    expect(undoEditorInteraction(active)).toEqual({
      state: expect.any(Object),
      diagnostics: [{ type: 'active-gesture-conflict' }],
    });
    expect(undoEditorInteraction(active).state.runtime).toBe(active.runtime);
    expect(redoEditorInteraction(active).state.runtime).toBe(active.runtime);
  });

  it('does not mutate caller documents or normalized input objects', () => {
    const inputDocument = documentWith(pen('first'));
    const pointer = input('down', 'paper', 1, 2);
    const pointerBefore = JSON.parse(JSON.stringify(pointer));
    const initial = createEditorInteractionState(inputDocument);
    const begun = beginEditorGesture(initial).state;
    reduceEditorGesture(begun, pointer);
    inputDocument.strokes[0].points[0].x = 99;

    expect(initial.runtime.documentState.document.strokes[0].points[0].x).toBe(0);
    expect(begun.runtime.documentState.document.strokes[0].points[0].x).toBe(0);
    expect(pointer).toEqual(pointerBefore);
  });

  it('copies selection configuration so later caller mutation cannot change a future gesture', () => {
    const first = pen('first');
    const targets = [target(0, first)];
    const descriptor = {
      kind: 'move' as const,
      box: { center: { x: 0, y: 0 }, width: 10, height: 10, rotationRad: 0 },
    };
    const configured = setEditorSelection(
      createEditorInteractionState(documentWith(first)),
      targets,
      descriptor
    ).state;
    targets[0] = { index: 0, expectedId: 'stale', expectedTool: 'pen' };
    descriptor.box.center.x = 99;
    const completed = reduceEditorGesture(
      reduceEditorGesture(
        beginEditorGesture(configured).state,
        input('down', 'selection', 0, 0)
      ).state,
      input('up', 'selection', 4, 0)
    ).state;

    expect(completed.runtime.documentState.document.strokes[0].points).toEqual([
      { x: 4, y: 0, pressure: 0.5 },
    ]);
    expect(completed.runtime.undoStack).toHaveLength(1);
  });

  it.each([
    [{ scale: 0.25, tx: 40, ty: -20 }, { x: 8, y: -4 }, { x: 32, y: -16 }],
    [{ scale: 1, tx: 40, ty: -20 }, { x: 8, y: -4 }, { x: 8, y: -4 }],
    [{ scale: 8, tx: 40, ty: -20 }, { x: 8, y: -4 }, { x: 1, y: -0.5 }],
  ] as const)('maps selection screen move through frozen viewport %#', (viewport, screenDelta, worldDelta) => {
    expect(selectionIntentToWorld({ kind: 'move', delta: screenDelta }, viewport)).toEqual({
      kind: 'move', delta: worldDelta,
    });
    expect(selectionIntentToWorld({ kind: 'rotate', pivot: { x: 56, y: -12 }, deltaRad: 0.5 }, viewport)).toEqual({
      kind: 'rotate', pivot: { x: 16 / viewport.scale, y: 8 / viewport.scale }, deltaRad: 0.5,
    });
    expect(selectionIntentToWorld({ kind: 'uniform-scale', anchor: { x: 56, y: -12 }, scale: 1.5 }, viewport)).toEqual({
      kind: 'uniform-scale', anchor: { x: 16 / viewport.scale, y: 8 / viewport.scale }, scale: 1.5,
    });
  });

  it('previews and commits scalar uniform-scale with identical replacements and one history entry', () => {
    const first = pen('first', 4);
    const descriptor = {
      kind: 'uniform-scale' as const,
      box: { center: { x: 4, y: 0 }, width: 4, height: 4, rotationRad: 0 },
      anchor: { x: 2, y: -2 },
      handle: { x: 6, y: 2 },
      minimumScreenExtent: 1,
    };
    const configured = setEditorSelection(
      createEditorInteractionState(documentWith(first), { viewport: { scale: 2, tx: 10, ty: -6 } }),
      [target(0, first)],
      descriptor
    ).state;
    const down = reduceEditorGesture(beginEditorGesture(configured).state, input('down', 'selection', 6, 2)).state;
    const preview = reduceEditorGesture(down, input('move', 'selection', 10, 6)).state;
    const committed = reduceEditorGesture(preview, input('up', 'selection', 10, 6)).state;
    const cancelled = reduceEditorGesture(
      reduceEditorGesture(beginEditorGesture(configured).state, input('down', 'selection', 6, 2)).state,
      input('cancel', 'selection', 10, 6)
    ).state;

    expect(preview.selectionPreview?.intent).toEqual({
      kind: 'uniform-scale', anchor: { x: -4, y: 2 }, scale: 2,
    });
    expect(preview.selectionPreview?.document.strokes[0].points).toEqual([
      { x: 12, y: -2, pressure: 0.5 },
    ]);
    expect(committed.runtime.documentState.document).toEqual(preview.selectionPreview?.document);
    expect(committed.runtime.undoStack).toHaveLength(1);
    expect(cancelled.runtime).toBe(configured.runtime);
    expect(cancelled.runtime.undoStack).toEqual([]);
  });

  it('does not materialize a preview for stale or duplicate selection targets', () => {
    const first = pen('first', 2);
    const descriptor = {
      kind: 'move' as const,
      box: { center: { x: 2, y: 0 }, width: 4, height: 4, rotationRad: 0 },
    };
    const configured = setEditorSelection(
      createEditorInteractionState(documentWith(first)),
      [target(0, first), target(0, first)],
      descriptor
    ).state;
    const duplicatePreview = reduceEditorGesture(
      reduceEditorGesture(beginEditorGesture(configured).state, input('down', 'selection', 2, 0)).state,
      input('move', 'selection', 8, 0)
    ).state;
    const started = reduceEditorGesture(
      beginEditorGesture(setEditorSelection(createEditorInteractionState(documentWith(first)), [target(0, first)], descriptor).state).state,
      input('down', 'selection', 2, 0)
    ).state;
    const stale = {
      ...started,
      runtime: applyEditorRuntimeCommand(started.runtime, {
        type: 'append-stroke', expectedRevision: 0, stroke: pen('external', 20),
      }).state,
    };
    const stalePreview = reduceEditorGesture(stale, input('move', 'selection', 8, 0)).state;

    expect(duplicatePreview.selectionPreview).toBeUndefined();
    expect(stalePreview.selectionPreview).toBeUndefined();
    expect(stalePreview.selectionTargets).toEqual([]);
    expect(stalePreview.selectionDescriptor).toBeUndefined();
  });

  it('clears selection after replace/remove/undo/redo but preserves valid targets after append', () => {
    const first = pen('first', 2);
    const selected = setEditorSelection(createEditorInteractionState(documentWith(first)), [target(0, first)]).state;
    const appended = commitEditorInteractionCommand(selected, {
      type: 'append-stroke', expectedRevision: 0, stroke: pen('second', 10),
    }).state;
    const replaced = commitEditorInteractionCommand(appended, {
      type: 'replace-strokes', expectedRevision: 1,
      replacements: [{ target: target(0, first), stroke: pen('first', 9) }],
    }).state;
    const selectedAgain = setEditorSelection(appended, [target(0, first)]).state;
    const removed = commitEditorInteractionCommand(selectedAgain, {
      type: 'remove-strokes', expectedRevision: 1, targets: [target(0, first)],
    }).state;
    const undone = undoEditorInteraction(selectedAgain).state;
    const redone = redoEditorInteraction(undone).state;

    expect(appended.selectionTargets).toEqual([target(0, first)]);
    for (const state of [replaced, removed, undone, redone]) {
      expect(state.selectionTargets).toEqual([]);
      expect(state.selectionDescriptor).toBeUndefined();
      expect(state.selectionPreview).toBeUndefined();
    }
  });

  it('preserves all duplicate-safe targets after its own multi-target transform commit', () => {
    const first = pen('duplicate', 2);
    const second = { ...pen('duplicate', 12), tool: 'line' as const };
    const selected = setEditorSelection(
      createEditorInteractionState(documentWith(first, second)),
      [target(0, first), target(1, second)]
    ).state;
    const committed = commitEditorInteractionCommand(selected, {
      type: 'apply-selection-transform',
      expectedRevision: 0,
      targets: [target(0, first), target(1, second)],
      intent: { kind: 'move', delta: { x: 3, y: -1 } },
    }).state;

    expect(committed.selectionTargets).toEqual([target(0, first), target(1, second)]);
    expect(committed.selectionDescriptor).toBeUndefined();
    expect(committed.runtime.documentState.document.strokes.map((stroke) => stroke.points[0])).toEqual([
      { x: 5, y: -1, pressure: 0.5 },
      { x: 15, y: -1, pressure: 0.5 },
    ]);
  });

  it('clears selection for a successful complete text-session document commit', () => {
    const first = pen('first', 2);
    const selected = setEditorSelection(createEditorInteractionState(documentWith(first)), [target(0, first)]).state;
    const committed = commitEditorInteractionDocument(selected, 0, documentWith()).state;

    expect(committed.runtime.documentState.document.strokes).toEqual([]);
    expect(committed.selectionTargets).toEqual([]);
    expect(committed.selectionDescriptor).toBeUndefined();
    expect(committed.selectionPreview).toBeUndefined();
  });
});
