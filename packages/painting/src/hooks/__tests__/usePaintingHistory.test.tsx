import { fireEvent, render, screen } from '@testing-library/react';
import type { DrawingValue } from '../../components/DrawingSurface';
import { usePaintingHistory } from '../usePaintingHistory';

const EMPTY_VALUE: DrawingValue = { strokes: [] };
const BOARD_A_VALUE: DrawingValue = {
  strokes: [
    {
      id: 'stroke-a',
      tool: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  ],
};
const BOARD_B_VALUE: DrawingValue = {
  strokes: [
    {
      id: 'stroke-b',
      tool: 'line',
      points: [
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
    },
  ],
};

function SharedHistoryHarness() {
  const history = usePaintingHistory({
    boardA: EMPTY_VALUE,
    boardB: EMPTY_VALUE,
  });

  return (
    <>
      <output data-testid="board-a-count">{history.values.boardA?.strokes.length}</output>
      <output data-testid="board-b-count">{history.values.boardB?.strokes.length}</output>
      <output data-testid="board-a-point-x">
        {history.values.boardA?.strokes[0]?.points[0]?.x ?? 'empty'}
      </output>
      <button type="button" onClick={() => history.setValue('boardA', BOARD_A_VALUE)}>
        Draw A
      </button>
      <button type="button" onClick={() => history.setValue('boardB', BOARD_B_VALUE)}>
        Draw B
      </button>
      <button
        type="button"
        onClick={() => {
          history.setValue('boardA', BOARD_A_VALUE);
          history.setValue('boardB', BOARD_B_VALUE);
        }}
      >
        Draw Both
      </button>
      <button
        type="button"
        onClick={() => {
          history.setValues({ boardA: BOARD_A_VALUE, boardB: EMPTY_VALUE });
          history.setValue('boardB', BOARD_B_VALUE);
        }}
      >
        Replace Then Draw B
      </button>
      <button
        type="button"
        onClick={() => {
          history.reset({ boardA: BOARD_A_VALUE, boardB: EMPTY_VALUE });
          history.setValue('boardB', BOARD_B_VALUE);
        }}
      >
        Reset Then Draw B
      </button>
      <button
        type="button"
        onClick={() => {
          history.beginTransaction();
          history.setValue('boardA', {
            strokes: [{ ...BOARD_A_VALUE.strokes[0], points: [{ x: 1, y: 1 }] }],
          });
          history.setValue('boardA', {
            strokes: [{ ...BOARD_A_VALUE.strokes[0], points: [{ x: 2, y: 2 }] }],
          });
          history.setValue('boardA', BOARD_A_VALUE);
          history.endTransaction();
        }}
      >
        Rotate A
      </button>
      <button
        type="button"
        onClick={() => {
          history.beginTransaction();
          history.setValue('boardA', {
            strokes: [{ ...BOARD_A_VALUE.strokes[0], points: [{ x: 1, y: 1 }] }],
          });
          history.beginTransaction();
          history.setValue('boardA', BOARD_A_VALUE);
          history.endTransaction();
          history.endTransaction();
        }}
      >
        Nested Rotate A
      </button>
      <button type="button" onClick={history.undo} disabled={!history.canUndo}>
        Undo
      </button>
      <button type="button" onClick={history.redo} disabled={!history.canRedo}>
        Redo
      </button>
    </>
  );
}

describe('usePaintingHistory', () => {
  it('shares one chronological undo and redo stack across multiple boards', () => {
    // Given: 两块空画板绑定同一个历史对象。
    render(<SharedHistoryHarness />);

    // When: 先在 A 绘制，再在 B 绘制，然后依次撤销两次。
    fireEvent.click(screen.getByRole('button', { name: 'Draw A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // Then: 第一次仅撤销 B，第二次再撤销 A；恢复按相反方向重放。
    expect(screen.getByTestId('board-a-count').textContent).toBe('1');
    expect(screen.getByTestId('board-b-count').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('board-a-count').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('board-a-count').textContent).toBe('1');
  });

  it('preserves every board update dispatched in the same React batch', () => {
    // Given: 两块空画板绑定同一个历史对象。
    render(<SharedHistoryHarness />);

    // When: 同一个事件处理器连续更新 A、B 两块画板。
    fireEvent.click(screen.getByRole('button', { name: 'Draw Both' }));

    // Then: 第二次更新必须基于第一次更新后的最新快照，不能覆盖 A 的内容。
    expect(screen.getByTestId('board-a-count').textContent).toBe('1');
    expect(screen.getByTestId('board-b-count').textContent).toBe('1');
  });

  it.each(['Replace Then Draw B', 'Reset Then Draw B'])(
    'merges a board update from the latest values after %s in the same React batch',
    (actionName) => {
      // Given: 两块空画板绑定同一个历史对象。
      render(<SharedHistoryHarness />);

      // When: 整体替换历史当前值后，在同一事件中继续更新 B。
      fireEvent.click(screen.getByRole('button', { name: actionName }));

      // Then: 后续更新必须从整体替换后的 A 值继续合并。
      expect(screen.getByTestId('board-a-count').textContent).toBe('1');
      expect(screen.getByTestId('board-b-count').textContent).toBe('1');
    }
  );

  it('undoes and redoes all preview frames from one pointer gesture as one history entry', () => {
    // Given: 一次旋转手势会在拖动期间连续产生多个预览值。
    render(<SharedHistoryHarness />);

    // When: 三帧预览在同一个 pointer down → move → up 事务内写入历史。
    fireEvent.click(screen.getByRole('button', { name: 'Rotate A' }));
    expect(screen.getByTestId('board-a-count').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // Then: 一次撤销完整回到手势前，一次恢复直接回到最终帧。
    expect(screen.getByTestId('board-a-count').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('board-a-count').textContent).toBe('1');
  });

  it('keeps nested transaction scopes in one history entry until the outer scope ends', () => {
    // Given: 两层手势生命周期共享同一个画板历史。
    render(<SharedHistoryHarness />);

    // When: 外层和内层事务分别写入预览帧，再按相反顺序结束。
    fireEvent.click(screen.getByRole('button', { name: 'Nested Rotate A' }));
    expect(screen.getByTestId('board-a-point-x').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // Then: 一次撤销直接回到最外层事务之前，恢复则直达最终帧。
    expect(screen.getByTestId('board-a-point-x').textContent).toBe('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('board-a-point-x').textContent).toBe('0');
  });
});
