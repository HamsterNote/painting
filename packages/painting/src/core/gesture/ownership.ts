import type { NormalizedPointerInput, TargetRole } from '../input';

/** 可由 core 管理的交互对象；安全控件和空白命中不会占用 pointer。 */
export type PointerOwner = Extract<TargetRole, 'paper' | 'ruler' | 'selection'>;

/** 单个活跃 pointer 的不可变归属记录。downOrder 在该 ownership 生命周期中单调递增。 */
export type PointerOwnershipEntry = Readonly<{
  pointerId: string | number;
  owner: PointerOwner;
  downOrder: number;
}>;

/**
 * 纯逐 pointer ownership 状态。
 *
 * `active` 仅包含还未收到 up/cancel 的有效 down；它按 downOrder 升序排列。这里刻意
 * 没有全局 active gesture mode，因为不同 owner 的 pointer 必须可并发工作。
 */
export type PointerOwnershipState = Readonly<{
  active: readonly PointerOwnershipEntry[];
  nextDownOrder: number;
}>;

/** 可安全传递或保存的 ownership 副本；不会暴露 state 内部的数组或 entry 引用。 */
export type PointerOwnershipSnapshot = Readonly<{
  active: readonly PointerOwnershipEntry[];
  nextDownOrder: number;
}>;

function freezeEntries(entries: readonly PointerOwnershipEntry[]): readonly PointerOwnershipEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

function createState(
  active: readonly PointerOwnershipEntry[],
  nextDownOrder: number
): PointerOwnershipState {
  return Object.freeze({ active: freezeEntries(active), nextDownOrder });
}

function ownerForTarget(targetRole: TargetRole): PointerOwner | null {
  switch (targetRole) {
    case 'paper':
    case 'ruler':
    case 'selection':
      return targetRole;
    case 'safe-control':
    case 'none':
      return null;
  }
}

function entryFor(
  state: PointerOwnershipState,
  pointerId: NormalizedPointerInput['pointerId']
): PointerOwnershipEntry | undefined {
  return state.active.find((entry) => entry.pointerId === pointerId);
}

/** 创建没有任何活跃 pointer 的 ownership 状态。 */
export function createPointerOwnershipState(): PointerOwnershipState {
  return createState([], 0);
}

/** 返回 pointer 当前锁定的 owner；未知或非 owning pointer 返回 undefined。 */
export function getPointerOwner(
  state: PointerOwnershipState,
  pointerId: NormalizedPointerInput['pointerId']
): PointerOwner | undefined {
  return entryFor(state, pointerId)?.owner;
}

/**
 * 按 down 顺序取得指定 owner 的活跃 pointer ID。
 *
 * `paper` 查询天然不会计入 ruler、selection、安全控件或空白命中，因为后二者从不
 * 进入 active，前二者有自己的固定 owner。
 */
export function getActivePointerIds(
  state: PointerOwnershipState,
  owner: PointerOwner
): readonly (string | number)[] {
  return state.active.filter((entry) => entry.owner === owner).map((entry) => entry.pointerId);
}

/** 按 owner 统计活跃 pointer，语义与 getActivePointerIds 保持一致。 */
export function getActivePointerCount(state: PointerOwnershipState, owner: PointerOwner): number {
  return getActivePointerIds(state, owner).length;
}

/**
 * 处理一个离散 pointer 生命周期样本。
 *
 * owner 只在首次有效 down 时按 targetRole 决定，之后 move 即使穿过其他目标也不会重分
 * 配。重复 down 与未知 move/up/cancel 都保留原 state；up/cancel 只清理已归属 pointer。
 * 此函数不构造 GestureSession，也不解释绘制、尺子、选框或 viewport 行为。
 */
export function reducePointerOwnership(
  state: PointerOwnershipState,
  input: NormalizedPointerInput
): PointerOwnershipState {
  const existing = entryFor(state, input.pointerId);

  if (input.phase === 'down') {
    if (existing) {
      return state;
    }

    const owner = ownerForTarget(input.targetRole);
    return owner === null
      ? state
      : createState(
          [...state.active, { pointerId: input.pointerId, owner, downOrder: state.nextDownOrder }],
          state.nextDownOrder + 1
        );
  }

  if (input.phase === 'up' || input.phase === 'cancel') {
    return existing
      ? createState(
          state.active.filter((entry) => entry.pointerId !== input.pointerId),
          state.nextDownOrder
        )
      : state;
  }

  // move 以及类型绕过后传入的未知 phase 都不应隐式创建或重新分配 ownership。
  return state;
}

/**
 * 创建独立、冻结的状态快照，供后续 paper 内仲裁读取 down 顺序。
 *
 * snapshot 只复制当前 ownership；不会成为 GestureSession，也不会随原 state 的后续转换
 * 而变化。
 */
export function snapshotPointerOwnership(state: PointerOwnershipState): PointerOwnershipSnapshot {
  return Object.freeze({ active: freezeEntries(state.active), nextDownOrder: state.nextDownOrder });
}
