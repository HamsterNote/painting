import {
  isNormalizedPointerInput,
  reduceGestureSession,
  type GestureSession,
  type GestureSessionEffect,
  type NormalizedPointerInput,
} from '../../core';

export type GestureSessionBridge = Readonly<{
  handleInput: (input: NormalizedPointerInput) => void;
  getSession: () => GestureSession;
  reset: () => void;
}>;

export type CreateGestureSessionBridgeOptions = Readonly<{
  createSession: () => GestureSession;
  onEffects?: (effects: readonly GestureSessionEffect[]) => void;
}>;

/**
 * 将已规范化的输入顺序交给纯 core session。它不导入 DOM；为使 reset 能安全结束每一个
 * owner，保留每个 pointer 最后的完整样本并把该样本改写为 cancel 后再交给 reducer。
 */
export function createGestureSessionBridge(
  options: CreateGestureSessionBridgeOptions
): GestureSessionBridge {
  let session = options.createSession();
  const lastInputs = new Map<NormalizedPointerInput['pointerId'], NormalizedPointerInput>();

  const dispatch = (input: NormalizedPointerInput) => {
    const transition = reduceGestureSession(session, input);
    session = transition.session;
    if (transition.effects.length > 0) {
      options.onEffects?.(transition.effects);
    }
  };

  return Object.freeze({
    handleInput: (input) => {
      if (isNormalizedPointerInput(input)) {
        lastInputs.set(input.pointerId, input);
      }
      dispatch(input);
      if (input.phase === 'up' || input.phase === 'cancel') {
        lastInputs.delete(input.pointerId);
      }
    },
    getSession: () => session,
    reset: () => {
      // 每一次 cancel 都以 reducer 返回的新 session 为起点，避免并发 owner 遗留预览。
      for (const { pointerId } of session.ownership.active) {
        const input = lastInputs.get(pointerId);
        if (input) {
          dispatch({ ...input, phase: 'cancel' });
        }
      }
      lastInputs.clear();
      session = options.createSession();
    },
  });
}
