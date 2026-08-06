import { useCallback, useMemo, useRef } from 'react';
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
  /** 开始把连续预览更新合并为一个可撤销操作。 */
  readonly beginTransaction: () => void;
  /** 结束当前连续更新事务。 */
  readonly endTransaction: () => void;
}

/** 创建可由一个或多个 PaintingBoard 共用的按操作排序历史栈。 */
export function usePaintingHistory(initialValues: PaintingHistoryValues): PaintingHistory {
  const [state, actions] = useUndo<PaintingHistoryValues>(initialValues, { useCheckpoints: true });
  const presentRef = useRef(state.present);
  const transactionDepthRef = useRef(0);
  const transactionCheckpointPendingRef = useRef(false);
  presentRef.current = state.present;
  const beginTransaction = useCallback(() => {
    if (transactionDepthRef.current === 0) {
      transactionCheckpointPendingRef.current = true;
    }
    transactionDepthRef.current += 1;
  }, []);
  const endTransaction = useCallback(() => {
    transactionDepthRef.current = Math.max(0, transactionDepthRef.current - 1);
    if (transactionDepthRef.current === 0) {
      transactionCheckpointPendingRef.current = false;
    }
  }, []);
  const setValue = useCallback(
    (boardId: string, value: DrawingValue) => {
      const nextValues = { ...presentRef.current, [boardId]: value };
      presentRef.current = nextValues;
      actions.set(
        nextValues,
        transactionDepthRef.current === 0 || transactionCheckpointPendingRef.current
      );
      transactionCheckpointPendingRef.current = false;
    },
    [actions]
  );
  const setValues = useCallback(
    (values: PaintingHistoryValues) => {
      presentRef.current = values;
      actions.set(values, transactionDepthRef.current === 0 || transactionCheckpointPendingRef.current);
      transactionCheckpointPendingRef.current = false;
    },
    [actions]
  );
  const reset = useCallback(
    (values: PaintingHistoryValues) => {
      presentRef.current = values;
      transactionDepthRef.current = 0;
      transactionCheckpointPendingRef.current = false;
      actions.reset(values);
    },
    [actions]
  );

  return useMemo(
    () => ({
      values: state.present,
      setValue,
      setValues,
      reset,
      beginTransaction,
      endTransaction,
      undo: actions.undo,
      redo: actions.redo,
      canUndo: actions.canUndo,
      canRedo: actions.canRedo,
    }),
    [actions, beginTransaction, endTransaction, reset, setValue, setValues, state.present]
  );
}
