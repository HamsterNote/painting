/** @jest-environment node */

import {
  applyEditorRuntimeCommand,
  commitEditorRuntimeDocument,
  commitSelectionIntent,
  createEditorRuntimeState,
  redoEditorRuntime,
  undoEditorRuntime,
  type EditorRuntimeState,
} from '../../core/editorRuntime';
import type { EditorDocumentCommand } from '../../core/editorDocument';
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

function target(index: number, stroke: DrawingStrokeV2) {
  return { index, expectedId: stroke.id, expectedTool: stroke.tool } as const;
}

function ids(state: EditorRuntimeState): string[] {
  return state.documentState.document.strokes.map((stroke) => stroke.id);
}

describe('core/editorRuntime', () => {
  it('records append, replace, and remove as three individually undoable commits', () => {
    const first = pen('first');
    const initial = createEditorRuntimeState(documentWith(first));
    const appended = applyEditorRuntimeCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: pen('second'),
    });
    const replaced = applyEditorRuntimeCommand(appended.state, {
      type: 'replace-strokes',
      expectedRevision: 1,
      replacements: [{ target: target(1, appended.state.documentState.document.strokes[1]), stroke: pen('second', 20) }],
    });
    const removed = applyEditorRuntimeCommand(replaced.state, {
      type: 'remove-strokes',
      expectedRevision: 2,
      targets: [target(0, replaced.state.documentState.document.strokes[0])],
    });

    expect(ids(removed.state)).toEqual(['second']);
    expect(removed.state.undoStack).toHaveLength(3);
    expect(ids(undoEditorRuntime(removed.state).state)).toEqual(['first', 'second']);
    expect(undoEditorRuntime(undoEditorRuntime(removed.state).state).state.documentState.document.strokes[1].points).toEqual([
      { x: 0, y: 0, pressure: 0.5 },
    ]);
    expect(ids(undoEditorRuntime(undoEditorRuntime(undoEditorRuntime(removed.state).state).state).state)).toEqual([
      'first',
    ]);
  });

  it('moves A to B to C through two undo and redo operations with exact snapshots', () => {
    const initial = createEditorRuntimeState(documentWith());
    const b = applyEditorRuntimeCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: pen('B'),
    }).state;
    const c = applyEditorRuntimeCommand(b, {
      type: 'append-stroke',
      expectedRevision: 1,
      stroke: pen('C'),
    }).state;
    const undoOne = undoEditorRuntime(c).state;
    const undoTwo = undoEditorRuntime(undoOne).state;
    const redoOne = redoEditorRuntime(undoTwo).state;
    const redoTwo = redoEditorRuntime(redoOne).state;

    expect(ids(c)).toEqual(['B', 'C']);
    expect(ids(undoOne)).toEqual(['B']);
    expect(ids(undoTwo)).toEqual([]);
    expect(ids(redoOne)).toEqual(['B']);
    expect(ids(redoTwo)).toEqual(['B', 'C']);
    expect(redoTwo.documentState.revision).toBe(2);
  });

  it('clears redo only after a real new commit', () => {
    const initial = createEditorRuntimeState(documentWith());
    const b = applyEditorRuntimeCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: pen('B'),
    }).state;
    const c = applyEditorRuntimeCommand(b, {
      type: 'append-stroke',
      expectedRevision: 1,
      stroke: pen('C'),
    }).state;
    const undone = undoEditorRuntime(c).state;
    const noop = applyEditorRuntimeCommand(undone, {
      type: 'remove-strokes',
      expectedRevision: 1,
      targets: [],
    });
    const branch = applyEditorRuntimeCommand(undone, {
      type: 'append-stroke',
      expectedRevision: 1,
      stroke: pen('D'),
    });

    expect(noop.state).toBe(undone);
    expect(noop.state.redoStack).toHaveLength(1);
    expect(ids(branch.state)).toEqual(['B', 'D']);
    expect(branch.state.redoStack).toEqual([]);
    expect(redoEditorRuntime(branch.state)).toEqual({
      state: branch.state,
      diagnostics: [{ type: 'cannot-redo' }],
    });
  });

  it('keeps failed, stale, no-op, and invalid commands out of history', () => {
    const first = pen('first');
    const state = createEditorRuntimeState(documentWith(first));
    const revisionMismatch = applyEditorRuntimeCommand(state, {
      type: 'append-stroke',
      expectedRevision: 1,
      stroke: pen('second'),
    });
    const staleTarget = applyEditorRuntimeCommand(state, {
      type: 'remove-strokes',
      expectedRevision: 0,
      targets: [{ index: 0, expectedId: 'stale', expectedTool: 'pen' }],
    });
    const noop = applyEditorRuntimeCommand(state, {
      type: 'remove-strokes',
      expectedRevision: 0,
      targets: [],
    });
    const invalid = applyEditorRuntimeCommand(state, {
      type: 'not-a-command',
      expectedRevision: 0,
    } as unknown as EditorDocumentCommand);

    for (const result of [revisionMismatch, staleTarget, noop, invalid]) {
      expect(result.state).toBe(state);
      expect(result.state.undoStack).toEqual([]);
      expect(result.state.redoStack).toEqual([]);
    }
    expect(invalid.diagnostics).toEqual([{ type: 'invalid-editor-command' }]);
  });

  it('commits a successful selection intent once and rejects non-uniform scale without history', () => {
    const first = pen('first', 4);
    const state = createEditorRuntimeState(documentWith(first));
    const moved = commitSelectionIntent(state, [target(0, first)], {
      kind: 'move',
      delta: { x: 3, y: -2 },
    });
    const rejected = commitSelectionIntent(moved.state, [target(0, moved.state.documentState.document.strokes[0])], {
      kind: 'resize',
      anchor: { x: 0, y: 0 },
      axis: { x: 1, y: 1 },
      scale: { x: 2, y: 3 },
    });

    expect(moved.state.undoStack).toHaveLength(1);
    expect(moved.state.documentState.document.strokes[0].points).toEqual([{ x: 7, y: -2, pressure: 0.5 }]);
    expect(rejected.state).toBe(moved.state);
    expect(rejected.diagnostics).toEqual([
      { type: 'non-uniform-selection-scale', scale: { x: 2, y: 3 } },
    ]);
  });

  it('targets duplicate IDs by index, ID, and tool through runtime history', () => {
    const first = pen('duplicate', 1);
    const second = { ...pen('duplicate', 2), tool: 'line' as const };
    const state = createEditorRuntimeState(documentWith(first, second));
    const result = applyEditorRuntimeCommand(state, {
      type: 'replace-strokes',
      expectedRevision: 0,
      replacements: [{ target: target(1, second), stroke: { ...second, points: [{ x: 10, y: 0 }] } }],
    });

    expect(result.state.documentState.document.strokes[0]).toMatchObject({ tool: 'pen', points: [{ x: 1, y: 0 }] });
    expect(result.state.documentState.document.strokes[1]).toMatchObject({ tool: 'line', points: [{ x: 10, y: 0 }] });
    expect(undoEditorRuntime(result.state).state.documentState.document.strokes[1]).toMatchObject({ points: [{ x: 2, y: 0 }] });
  });

  it('protects initial input and history snapshots from later caller array mutation', () => {
    const input = pen('input', 1);
    const document = documentWith(input);
    const state = createEditorRuntimeState(document);
    input.points[0].x = 99;
    input.dashArray?.push(8);
    document.strokes.push(pen('outside'));
    const appendInput = pen('append', 2);
    const committed = applyEditorRuntimeCommand(state, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: appendInput,
    });
    appendInput.points[0].x = 88;
    appendInput.dashArray?.push(9);

    expect(state.documentState.document.strokes).toEqual([pen('input', 1)]);
    expect(committed.state.documentState.document.strokes[1]).toEqual(pen('append', 2));
    expect(undoEditorRuntime(committed.state).state.documentState.document.strokes).toEqual([pen('input', 1)]);
  });

  it('returns explicit diagnostics without replacing state when undo or redo is unavailable', () => {
    const state = createEditorRuntimeState(documentWith());

    expect(undoEditorRuntime(state)).toEqual({ state, diagnostics: [{ type: 'cannot-undo' }] });
    expect(redoEditorRuntime(state)).toEqual({ state, diagnostics: [{ type: 'cannot-redo' }] });
  });

  it('accepts one revision-checked complete document snapshot without exposing caller mutation', () => {
    const state = createEditorRuntimeState(documentWith(pen('first')));
    const committedDocument = documentWith(pen('first'), pen('second'));
    const committed = commitEditorRuntimeDocument(state, 0, committedDocument);
    committedDocument.strokes[1].points[0].x = 99;
    const stale = commitEditorRuntimeDocument(committed.state, 0, documentWith(pen('other')));
    const noop = commitEditorRuntimeDocument(committed.state, 1, committed.state.documentState.document);

    expect(ids(committed.state)).toEqual(['first', 'second']);
    expect(committed.state.documentState.document.strokes[1].points[0].x).toBe(0);
    expect(committed.state.undoStack).toHaveLength(1);
    expect(stale).toEqual({
      state: committed.state,
      diagnostics: [{ type: 'revision-mismatch', expectedRevision: 0, actualRevision: 1 }],
    });
    expect(noop).toEqual({
      state: committed.state,
      diagnostics: [{ type: 'editor-document-noop' }],
    });
  });

  it('shares prefix stroke references across append commits (structural sharing)', () => {
    // 用小规模等价覆盖「10 万级前缀共享」语义：每次 append 后所有既有 stroke 引用必须复用。
    const total = 256;
    let state = createEditorRuntimeState(documentWith(pen('base')));
    const snapshots = [state.documentState];
    for (let index = 0; index < total; index += 1) {
      state = applyEditorRuntimeCommand(state, {
        type: 'append-stroke',
        expectedRevision: state.documentState.revision,
        stroke: pen(`s${index}`, index),
      }).state;
      snapshots.push(state.documentState);
    }

    const latest = state.documentState.document.strokes;
    expect(latest).toHaveLength(total + 1);
    expect(Object.isFrozen(latest)).toBe(true);

    // 相邻 snapshot：新数组只多一条，前缀逐条引用相同，证明没有整体重拷贝。
    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1].document.strokes;
      const next = snapshots[index].document.strokes;
      expect(next).toHaveLength(previous.length + 1);
      for (let position = 0; position < previous.length; position += 1) {
        expect(next[position]).toBe(previous[position]);
      }
      expect(next[previous.length]).not.toBe(previous[previous.length - 1]);
    }
    // 首条始终是初始 snapshot 的那条冻结引用。
    expect(latest[0]).toBe(snapshots[0].document.strokes[0]);
  });

  it('copies and freezes only the appended stroke so external mutation cannot reach the snapshot', () => {
    const initial = createEditorRuntimeState(documentWith(pen('first')));
    const external = pen('second', 5);
    const committed = applyEditorRuntimeCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: external,
    });
    const document = committed.state.documentState.document;
    const strokes = document.strokes;

    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(strokes)).toBe(true);
    expect(Object.isFrozen(strokes[1])).toBe(true);
    expect(Object.isFrozen(strokes[1].points)).toBe(true);
    expect(Object.isFrozen(strokes[1].points[0])).toBe(true);
    // 复用既有冻结引用，但绝不与外部可变输入共享新条目。
    expect(strokes[0]).toBe(initial.documentState.document.strokes[0]);
    expect(strokes[1]).not.toBe(external);
    expect(strokes[1].points).not.toBe(external.points);
    expect(strokes[1].points[0]).not.toBe(external.points[0]);

    external.points[0].x = 77;
    external.points.push({ x: 1, y: 1 });
    external.dashArray?.push(9);

    expect(strokes[1]).toEqual(pen('second', 5));
    expect(strokes[1].points).toEqual([{ x: 5, y: 0, pressure: 0.5 }]);
    expect(strokes[1].dashArray).toEqual([2, 4]);
  });

  it('keeps prior snapshots and undo/redo intact after shared-reference appends', () => {
    const initial = createEditorRuntimeState(documentWith(pen('a')));
    const first = applyEditorRuntimeCommand(initial, {
      type: 'append-stroke',
      expectedRevision: 0,
      stroke: pen('b'),
    }).state;
    const second = applyEditorRuntimeCommand(first, {
      type: 'append-stroke',
      expectedRevision: 1,
      stroke: pen('c'),
    }).state;

    expect(second.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['a', 'b', 'c']);

    // undo/redo 仍精确指向历史中同一个 snapshot 引用，未被结构共享覆盖。
    const undoOne = undoEditorRuntime(second).state;
    expect(undoOne.documentState).toBe(first.documentState);
    expect(undoOne.documentState.document.strokes.map((stroke) => stroke.id)).toEqual(['a', 'b']);

    const undoTwo = undoEditorRuntime(undoOne).state;
    expect(undoTwo.documentState).toBe(initial.documentState);
    expect(undoTwo.documentState.revision).toBe(0);

    const redoOne = redoEditorRuntime(undoTwo).state;
    expect(redoOne.documentState).toBe(first.documentState);

    const redoTwo = redoEditorRuntime(redoOne).state;
    expect(redoTwo.documentState).toBe(second.documentState);
    expect(redoTwo.documentState.revision).toBe(2);
  });

  it('keeps full defensive copies for non-append commands and complete-document commits', () => {
    const initial = createEditorRuntimeState(documentWith(pen('first', 1)));
    const replaced = applyEditorRuntimeCommand(initial, {
      type: 'replace-strokes',
      expectedRevision: 0,
      replacements: [{ target: target(0, initial.documentState.document.strokes[0]), stroke: pen('first', 9) }],
    });
    const strokes = replaced.state.documentState.document.strokes;

    // 非 append 命令维持整体深拷贝语义，不共享旧 snapshot 引用。
    expect(strokes[0]).not.toBe(initial.documentState.document.strokes[0]);
    expect(Object.isFrozen(strokes[0])).toBe(true);
    expect(strokes[0].points).toEqual([{ x: 9, y: 0, pressure: 0.5 }]);

    // 完整 document 提交仍是防御性拷贝。
    const externalDocument = documentWith(pen('x', 3));
    const committed = commitEditorRuntimeDocument(replaced.state, 1, externalDocument);
    externalDocument.strokes[0].points[0].x = 99;
    expect(committed.state.documentState.document.strokes[0].points[0].x).toBe(3);
    expect(Object.isFrozen(committed.state.documentState.document.strokes[0])).toBe(true);
  });
});
