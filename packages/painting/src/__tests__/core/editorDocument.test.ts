/** @jest-environment node */

import {
  applyEditorDocumentCommand,
  createEditorDocumentState,
  materializeEditorDocumentPreview,
  type DocumentStrokeTarget,
} from '../../core/editorDocument';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

function pen(id: string, x = 0): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'pen',
    points: [{ x, y: 0, pressure: 0.5 }],
    dashArray: [2, 4],
  };
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

function target(index: number, expectedId: string, expectedTool?: DocumentStrokeTarget['expectedTool']): DocumentStrokeTarget {
  return { index, expectedId, ...(expectedTool ? { expectedTool } : {}) };
}

describe('core/editorDocument', () => {
  it('rejects stale revisions without replacing the state or document references', () => {
    const state = createEditorDocumentState(documentWith(pen('first')), 3);
    const result = applyEditorDocumentCommand(state, {
      type: 'append-stroke',
      expectedRevision: 2,
      stroke: pen('second'),
    });

    expect(result.state).toBe(state);
    expect(result.state.document).toBe(state.document);
    expect(result.diagnostics).toEqual([
      { type: 'revision-mismatch', expectedRevision: 2, actualRevision: 3 },
    ]);
  });

  it('appends, replaces, removes, and clears immutably while advancing revision only for changes', () => {
    const initialStroke = pen('first');
    const inputStroke = pen('second', 5);
    const initial = createEditorDocumentState(documentWith(initialStroke));
    const appended = applyEditorDocumentCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: inputStroke,
    });
    const replacement = pen('second', 12);
    const replaced = applyEditorDocumentCommand(appended.state, {
      type: 'replace-strokes',
      expectedRevision: 1,
      replacements: [{ target: target(1, 'second', 'pen'), stroke: replacement }],
    });
    const removed = applyEditorDocumentCommand(replaced.state, {
      type: 'remove-strokes',
      expectedRevision: 2,
      targets: [target(0, 'first', 'pen')],
    });
    const cleared = applyEditorDocumentCommand(removed.state, {
      type: 'clear-strokes',
      expectedRevision: 3,
    });

    expect(appended.state.revision).toBe(1);
    expect(appended.state.document.strokes[1]).not.toBe(inputStroke);
    expect(appended.state.document.strokes[1].points).not.toBe(inputStroke.points);
    expect(replaced.state.revision).toBe(2);
    expect(replaced.state.document.strokes[0]).toBe(initialStroke);
    expect(replaced.state.document.strokes[1].points).toEqual([{ x: 12, y: 0, pressure: 0.5 }]);
    expect(removed.state).toMatchObject({ revision: 3, document: { strokes: [{ id: 'second' }] } });
    expect(cleared.state).toMatchObject({ revision: 4, document: { strokes: [] } });
    expect(initial.document).toEqual(documentWith(initialStroke));
    expect(inputStroke.points).toEqual([{ x: 5, y: 0, pressure: 0.5 }]);
  });

  it('uses index plus ID and tool to update an intended duplicate ID entry', () => {
    const first = pen('duplicate', 1);
    const second = { ...pen('duplicate', 2), tool: 'line' as const };
    const state = createEditorDocumentState(documentWith(first, second));
    const result = applyEditorDocumentCommand(state, {
      type: 'replace-strokes',
      expectedRevision: 0,
      replacements: [{ target: target(1, 'duplicate', 'line'), stroke: { ...second, points: [{ x: 9, y: 0 }] } }],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.state.revision).toBe(1);
    expect(result.state.document.strokes[0]).toBe(first);
    expect(result.state.document.strokes[1]).toMatchObject({ id: 'duplicate', tool: 'line', points: [{ x: 9, y: 0 }] });
  });

  it('keeps an atomic command unchanged when a target is stale or repeated', () => {
    const first = pen('first');
    const second = pen('second');
    const state = createEditorDocumentState(documentWith(first, second));
    const stale = applyEditorDocumentCommand(state, {
      type: 'remove-strokes',
      expectedRevision: 0,
      targets: [target(0, 'first'), target(1, 'missing')],
    });
    const duplicate = applyEditorDocumentCommand(state, {
      type: 'remove-strokes',
      expectedRevision: 0,
      targets: [target(0, 'first'), target(0, 'first')],
    });

    expect(stale.state).toBe(state);
    expect(stale.diagnostics).toEqual([{ type: 'document-target-mismatch', target: target(1, 'missing') }]);
    expect(duplicate.state).toBe(state);
    expect(duplicate.diagnostics).toEqual([{ type: 'duplicate-document-target', index: 0 }]);
  });

  it('treats empty and structurally identical commands as cancel-style no-ops', () => {
    const state = createEditorDocumentState(documentWith(pen('first')));
    const emptyRemoval = applyEditorDocumentCommand(state, {
      type: 'remove-strokes',
      expectedRevision: 0,
      targets: [],
    });
    const sameReplacement = applyEditorDocumentCommand(state, {
      type: 'replace-strokes',
      expectedRevision: 0,
      replacements: [{ target: target(0, 'first'), stroke: pen('first') }],
    });

    expect(emptyRemoval).toEqual({ state, diagnostics: [] });
    expect(sameReplacement).toEqual({ state, diagnostics: [] });
    expect(sameReplacement.state).toBe(state);
  });

  it('commits a selection transform atomically and keeps rejected scale commands stale-free', () => {
    const first = pen('first', 1);
    const second = pen('second', 10);
    const state = createEditorDocumentState(documentWith(first, second));
    const transformed = applyEditorDocumentCommand(state, {
      type: 'apply-selection-transform',
      expectedRevision: 0,
      targets: [target(0, 'first', 'pen'), target(1, 'second', 'pen')],
      intent: { kind: 'move', delta: { x: 3, y: -2 } },
    });
    const rejected = applyEditorDocumentCommand(transformed.state, {
      type: 'apply-selection-transform',
      expectedRevision: 1,
      targets: [target(0, 'first', 'pen')],
      intent: {
        kind: 'resize',
        anchor: { x: 0, y: 0 },
        axis: { x: 1, y: 1 },
        scale: { x: 2, y: 3 },
      },
    });

    expect(transformed.state.revision).toBe(1);
    expect(transformed.state.document.strokes.map((stroke) => stroke.points[0])).toEqual([
      { x: 4, y: -2, pressure: 0.5 },
      { x: 13, y: -2, pressure: 0.5 },
    ]);
    expect(state.document).toEqual(documentWith(first, second));
    expect(rejected.state).toBe(transformed.state);
    expect(rejected.diagnostics).toEqual([
      { type: 'non-uniform-selection-scale', scale: { x: 2, y: 3 } },
    ]);
  });

  it('materializes only successful replacement previews without writing revision', () => {
    const first = pen('first', 1);
    const state = createEditorDocumentState(documentWith(first), 3);
    const preview = materializeEditorDocumentPreview(state, {
      type: 'replace-strokes', expectedRevision: 3,
      replacements: [{ target: target(0, 'first', 'pen'), stroke: pen('first', 8) }],
    });
    const stale = materializeEditorDocumentPreview(state, {
      type: 'replace-strokes', expectedRevision: 2,
      replacements: [{ target: target(0, 'first', 'pen'), stroke: pen('first', 8) }],
    });
    const duplicate = materializeEditorDocumentPreview(state, {
      type: 'replace-strokes', expectedRevision: 3,
      replacements: [
        { target: target(0, 'first', 'pen'), stroke: pen('first', 8) },
        { target: target(0, 'first', 'pen'), stroke: pen('first', 9) },
      ],
    });

    expect(preview?.document.strokes[0].points).toEqual([{ x: 8, y: 0, pressure: 0.5 }]);
    expect(preview?.document).not.toBe(state.document);
    expect(state).toEqual(createEditorDocumentState(documentWith(first), 3));
    expect(stale).toBeNull();
    expect(duplicate).toBeNull();
  });
});
