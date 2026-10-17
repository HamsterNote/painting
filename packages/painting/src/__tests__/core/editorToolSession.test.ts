/** @jest-environment node */

import {
  addEditorToolVertex,
  beginEditorToolPointer,
  cancelEditorToolSession,
  createEditorToolSession,
  finishEditorBezier,
  finishEditorPolygon,
  finishEditorToolPointer,
  moveEditorToolPointer,
} from '../../core/editorToolSession';
import type { DrawingPointV2 } from '../../model/strokes';

function point(x: number, y: number, pressure?: number): DrawingPointV2 {
  return { x, y, ...(pressure === undefined ? {} : { pressure }) };
}

function session(tool: Parameters<typeof createEditorToolSession>[0]['tool']) {
  return createEditorToolSession({
    tool,
    createId: (strokeTool) => `stable-${strokeTool}`,
    style: { strokeColor: '#123456', strokeWidth: 3, dashArray: [2, 4] },
  }).session;
}

function pointerStroke(tool: 'pen' | 'line' | 'rect' | 'ellipse') {
  const begun = beginEditorToolPointer(session(tool), point(1, 2, 0.2)).session;
  const moved = moveEditorToolPointer(begun, point(8, 10, 0.8)).session;
  return finishEditorToolPointer(moved, point(12, 14, 0.9));
}

describe('core/editorToolSession', () => {
  it('constructs each continuous V2 drawing tool as a candidate only after a valid finish', () => {
    for (const tool of ['pen', 'line', 'rect', 'ellipse'] as const) {
      const result = pointerStroke(tool);

      expect(result.diagnostics).toEqual([]);
      expect(result.stroke).toMatchObject({
        schemaVersion: 2,
        id: `stable-${tool}`,
        tool,
        strokeColor: '#123456',
        strokeWidth: 3,
        dashArray: [2, 4],
      });
      expect(result.stroke?.points).toEqual(
        tool === 'pen'
          ? [point(1, 2, 0.2), point(8, 10, 0.8), point(12, 14, 0.9)]
          : [point(1, 2, 0.2), point(12, 14, 0.9)]
      );
      expect(result.session.status).toBe('finished');
    }
  });

  it('deduplicates adjacent pen positions and rejects a degenerate pen without a stroke', () => {
    const begun = beginEditorToolPointer(session('pen'), point(1, 1, 0.1)).session;
    const duplicateMove = moveEditorToolPointer(begun, point(1, 1, 0.8)).session;
    const finished = finishEditorToolPointer(duplicateMove, point(4, 1, 0.5));
    const dot = finishEditorToolPointer(
      beginEditorToolPointer(session('pen'), point(2, 2)).session,
      point(2, 2)
    );

    expect(finished.stroke?.points).toEqual([point(1, 1, 0.1), point(4, 1, 0.5)]);
    expect(dot.stroke).toBeUndefined();
    expect(dot.diagnostics).toEqual([{ type: 'degenerate-tool-geometry', tool: 'pen' }]);
  });

  it.each(['line', 'rect', 'ellipse'] as const)('rejects identical-point %s geometry', (tool) => {
    const begun = beginEditorToolPointer(session(tool), point(1, 2)).session;
    const same = finishEditorToolPointer(begun, point(1, 2));

    expect(same.stroke).toBeUndefined();
    expect(same.diagnostics).toEqual([{ type: 'degenerate-tool-geometry', tool }]);
  });

  it.each(['rect', 'ellipse'] as const)('rejects collapsed-axis %s geometry', (tool) => {
    const collapsedAxis = finishEditorToolPointer(
      beginEditorToolPointer(session(tool), point(1, 2)).session,
      point(1, 8)
    );

    expect(collapsedAxis.stroke).toBeUndefined();
    expect(collapsedAxis.diagnostics).toEqual([{ type: 'degenerate-tool-geometry', tool }]);
  });

  it('uses an explicit polygon vertex session, preserves order, ignores adjacent duplicates, and never auto-closes', () => {
    const first = addEditorToolVertex(session('polygon'), point(0, 0)).session;
    const duplicate = addEditorToolVertex(first, point(0, 0)).session;
    const second = addEditorToolVertex(duplicate, point(10, 0)).session;
    const third = addEditorToolVertex(second, point(5, 10)).session;
    const completed = finishEditorPolygon(third);
    const cancelled = cancelEditorToolSession(third);

    expect(completed.stroke).toMatchObject({ tool: 'polygon' });
    expect(completed.stroke?.points).toEqual([point(0, 0), point(10, 0), point(5, 10)]);
    expect(completed.stroke?.points).toHaveLength(3);
    expect(cancelled.stroke).toBeUndefined();
    expect(cancelled.session.status).toBe('cancelled');
  });

  it('rejects incomplete and degenerate polygons without candidates', () => {
    const incomplete = finishEditorPolygon(
      addEditorToolVertex(addEditorToolVertex(session('polygon'), point(0, 0)).session, point(1, 0)).session
    );
    let collinear = session('polygon');
    for (const candidate of [point(0, 0), point(2, 0), point(4, 0)]) {
      collinear = addEditorToolVertex(collinear, candidate).session;
    }
    const degenerate = finishEditorPolygon(collinear);

    expect(incomplete.diagnostics).toEqual([{ type: 'polygon-requires-three-vertices' }]);
    expect(degenerate.diagnostics).toEqual([{ type: 'polygon-degenerate' }]);
  });

  it('uses an explicit four-control Bézier session without manufacturing missing controls', () => {
    let incompleteSession = session('bezier');
    for (const candidate of [point(0, 0), point(2, 5), point(8, 5)]) {
      incompleteSession = addEditorToolVertex(incompleteSession, candidate).session;
    }
    const incomplete = finishEditorBezier(incompleteSession);
    const fourth = addEditorToolVertex(incompleteSession, point(10, 0)).session;
    const complete = finishEditorBezier(fourth);

    expect(incomplete.stroke).toBeUndefined();
    expect(incomplete.diagnostics).toEqual([{ type: 'bezier-requires-four-controls', count: 3 }]);
    expect(complete.stroke?.points).toEqual([point(0, 0), point(2, 5), point(8, 5), point(10, 0)]);
    expect(complete.stroke?.tool).toBe('bezier');
  });

  it('hands text, image, eraser, and lasso to their dedicated future flows without creating strokes', () => {
    expect(createEditorToolSession({ tool: 'text' }).diagnostics).toEqual([{ type: 'requires-text-session' }]);
    expect(createEditorToolSession({ tool: 'image' }).diagnostics).toEqual([{ type: 'requires-resource-import' }]);
    expect(createEditorToolSession({ tool: 'eraser' }).diagnostics).toEqual([
      { type: 'requires-query', tool: 'eraser' },
    ]);
    expect(createEditorToolSession({ tool: 'lasso' }).diagnostics).toEqual([
      { type: 'requires-query', tool: 'lasso' },
    ]);
  });

  it('requires a stable injected ID and does not mutate caller points or style arrays', () => {
    const input = point(1, 2, 0.5);
    const style = { dashArray: [1, 3] };
    const missingId = finishEditorToolPointer(
      beginEditorToolPointer(createEditorToolSession({ tool: 'line', style }).session, input).session,
      point(8, 9)
    );
    const created = pointerStroke('pen');
    input.x = 99;
    style.dashArray.push(5);

    expect(missingId.stroke).toBeUndefined();
    expect(missingId.diagnostics).toEqual([{ type: 'stable-id-required', tool: 'line' }]);
    expect(created.stroke?.dashArray).toEqual([2, 4]);
    expect(created.stroke?.points[0]).toEqual(point(1, 2, 0.2));
  });

  it('reports invalid world points and never throws or emits a candidate on cancellation', () => {
    const invalid = beginEditorToolPointer(session('line'), point(Number.NaN, 2));
    const cancelled = cancelEditorToolSession(beginEditorToolPointer(session('line'), point(1, 2)).session);

    expect(invalid.diagnostics).toEqual([{ type: 'invalid-world-point' }]);
    expect(cancelled.stroke).toBeUndefined();
    expect(cancelled.preview).toEqual([point(1, 2)]);
  });

  it('reuses frozen historical point references across pen moves and copies only the new point', () => {
    const begun = beginEditorToolPointer(session('pen'), point(1, 1, 0.1)).session;
    const firstInput = point(2, 2, 0.2);
    const moved = moveEditorToolPointer(begun, firstInput).session;
    const secondInput = point(3, 3, 0.3);
    const movedAgain = moveEditorToolPointer(moved, secondInput).session;

    // 既有冻结 point 引用跨 move 复用，且绝不与外部可变输入共享。
    expect(begun.points[0]).not.toBe(firstInput);
    expect(moved.points[0]).toBe(begun.points[0]);
    expect(movedAgain.points[0]).toBe(begun.points[0]);
    expect(movedAgain.points[1]).toBe(moved.points[1]);
    expect(movedAgain.points[1]).not.toBe(firstInput);
    expect(movedAgain.points[2]).not.toBe(secondInput);

    // 顶层数组每步都是新的冻结数组，旧数组保持不变。
    expect(moved.points).not.toBe(begun.points);
    expect(movedAgain.points).not.toBe(moved.points);
    expect(Object.isFrozen(movedAgain.points)).toBe(true);
    expect(Object.isFrozen(movedAgain.points[0])).toBe(true);
    expect(movedAgain.points).toHaveLength(3);
    expect(begun.points).toHaveLength(1);
  });

  it('isolates external point mutation from session snapshots and the final stroke', () => {
    const beginInput = point(1, 2, 0.4);
    const begun = beginEditorToolPointer(session('pen'), beginInput).session;
    const moveInput = point(5, 6, 0.6);
    const moved = moveEditorToolPointer(begun, moveInput).session;
    const finishInput = point(9, 10, 0.9);
    const finished = finishEditorToolPointer(moved, finishInput);

    beginInput.x = 111;
    moveInput.x = 222;
    finishInput.x = 333;

    expect(begun.points[0]).toEqual(point(1, 2, 0.4));
    expect(moved.points[1]).toEqual(point(5, 6, 0.6));
    expect(finished.stroke?.points).toEqual([point(1, 2, 0.4), point(5, 6, 0.6), point(9, 10, 0.9)]);
    expect(finished.stroke?.points[2].pressure).toBe(0.9);
    expect(Object.isFrozen(moved.points[1])).toBe(true);
  });

  it('keeps duplicate-adjacent pen moves structurally shared and preserves pressure', () => {
    const begun = beginEditorToolPointer(session('pen'), point(0, 0, 0.1)).session;
    const moved = moveEditorToolPointer(begun, point(1, 0, 0.5)).session;
    const duplicate = moveEditorToolPointer(moved, point(1, 0, 0.9)).session;

    // 相邻重复位置既不新增点也不复制数组，直接复用上一步的冻结 points。
    expect(duplicate.points).toBe(moved.points);
    expect(duplicate.points).toHaveLength(2);
    expect(duplicate.points[0].pressure).toBe(0.1);
    expect(duplicate.points[1].pressure).toBe(0.5);

    const finished = finishEditorToolPointer(duplicate, point(1, 0, 0.9));
    expect(finished.stroke?.points).toEqual([point(0, 0, 0.1), point(1, 0, 0.5)]);
  });

  it('cancels without copying points and keeps the final stroke a defensive copy', () => {
    const begun = beginEditorToolPointer(session('pen'), point(1, 1, 0.2)).session;
    const moved = moveEditorToolPointer(begun, point(4, 4, 0.8)).session;
    const cancelled = cancelEditorToolSession(moved);

    expect(cancelled.session.status).toBe('cancelled');
    expect(cancelled.session.points).toBe(moved.points);
    expect(cancelled.stroke).toBeUndefined();

    const finished = finishEditorToolPointer(moved, point(4, 4, 1));
    // 终态候选 stroke 仍做防御性深拷贝，不与会话 points 共享引用。
    expect(finished.stroke?.points).not.toBe(moved.points);
    expect(finished.stroke?.points[0]).not.toBe(moved.points[0]);
    expect(finished.stroke?.points).toEqual([point(1, 1, 0.2), point(4, 4, 0.8)]);
  });

  it('shares the stable first endpoint for shape tools while copying each new endpoint', () => {
    const beginInput = point(1, 2, 0.3);
    const begun = beginEditorToolPointer(session('line'), beginInput).session;
    const moved = moveEditorToolPointer(begun, point(5, 6, 0.7)).session;
    const movedAgain = moveEditorToolPointer(moved, point(9, 10, 0.9)).session;

    expect(moved.points[0]).toBe(begun.points[0]);
    expect(movedAgain.points[0]).toBe(begun.points[0]);
    expect(movedAgain.points[1]).not.toBe(moved.points[1]);
    expect(movedAgain.points).toHaveLength(2);
    expect(begun.points).toHaveLength(1);
    expect(Object.isFrozen(movedAgain.points)).toBe(true);
  });
});
