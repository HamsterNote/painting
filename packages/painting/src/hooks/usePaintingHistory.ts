import { useCallback, useMemo } from 'react';
import useUndo from 'use-undo';
import type { DrawingValue } from '../components/DrawingSurface';

export type PaintingHistoryValues = Readonly<Record<string, DrawingValue>>;

export interface PaintingHistoryControls {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
}

export interface PaintingHistory extends PaintingHistoryControls {
  readonly values: PaintingHistoryValues;
  readonly setValue: (boardId: string, value: DrawingValue) => void;
  readonly setValues: (values: PaintingHistoryValues) => void;
  readonly reset: (values: PaintingHistoryValues) => void;
}

/** 创建可由一个或多个 PaintingBoard 共用的按操作排序历史栈。 */
export function usePaintingHistory(initialValues: PaintingHistoryValues): PaintingHistory {
  const [state, actions] = useUndo<PaintingHistoryValues>(initialValues);
  const setValue = useCallback(
    (boardId: string, value: DrawingValue) => {
      actions.set({ ...state.present, [boardId]: value });
    },
    [actions, state.present]
  );

  return useMemo(
    () => ({
      values: state.present,
      setValue,
      setValues: actions.set,
      reset: actions.reset,
      undo: actions.undo,
      redo: actions.redo,
      canUndo: actions.canUndo,
      canRedo: actions.canRedo,
    }),
    [actions, setValue, state.present]
  );
}
