import type { DrawingValueV2 } from '../model/strokes';

/**
 * 不进入持久 document 的高频交互数据。
 *
 * core 不解释这些字段，渲染层可存放当前手势、预览笔迹或相机反馈；使用 readonly
 * 索引签名确保调用方按替换而非原地修改的方式更新它。
 */
export type TransientState = Readonly<Record<string, unknown>>;

/** core 的持久文档与瞬态交互状态。 */
export type CoreState = Readonly<{
  document: DrawingValueV2;
  transient: TransientState;
}>;

/** 宿主需要转交给 history、持久化或受控回调的唯一 core 副作用。 */
export type CoreEffect = Readonly<{
  type: 'document-commit';
  document: DrawingValueV2;
}>;

/** 单步 core 转换的纯结果。只有 document 提交会包含 effect。 */
export type CoreTransition = Readonly<{
  state: CoreState;
  effects: readonly CoreEffect[];
}>;

const EMPTY_TRANSIENT: TransientState = Object.freeze({});
const NO_EFFECTS: readonly CoreEffect[] = Object.freeze([]);

function withoutEffects(state: CoreState): CoreTransition {
  return { state, effects: NO_EFFECTS };
}

/**
 * 创建 core 状态。初始 transient 不会影响 document，也不会产生持久化副作用。
 */
export function createCoreState(
  document: DrawingValueV2,
  transient: TransientState = EMPTY_TRANSIENT
): CoreTransition {
  return withoutEffects({ document, transient });
}

/**
 * 整体替换高频 transient 数据。document 引用严格保持不变，effects 恒为空。
 */
export function updateTransient(state: CoreState, transient: TransientState): CoreTransition {
  return withoutEffects({ document: state.document, transient });
}

/**
 * 取消当前交互预览。它是 clearTransient 的语义别名，且不会提交 document。
 */
export function cancelTransient(state: CoreState): CoreTransition {
  return withoutEffects({ document: state.document, transient: EMPTY_TRANSIENT });
}

/**
 * 清除所有 transient 字段。document 引用保持不变，effects 恒为空。
 */
export function clearTransient(state: CoreState): CoreTransition {
  return cancelTransient(state);
}

/**
 * 在一个离散步骤中将新的 V2 document 写入 core，并发出唯一的提交 effect。
 *
 * transient 不会被合并进 document；调用方可在提交后单独清除预览，或将下一帧 transient
 * 与这次提交的 state 组合。为维持提交语义，commit 始终返回新的 CoreState。
 */
export function commitDocument(state: CoreState, document: DrawingValueV2): CoreTransition {
  const nextState: CoreState = { document, transient: state.transient };
  return {
    state: nextState,
    effects: [{ type: 'document-commit', document }],
  };
}
