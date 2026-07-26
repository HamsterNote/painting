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
});
