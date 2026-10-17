import { isNormalizedPointerInput } from '../../core/internal';
import type { InputDevice, NormalizedPointerInput, TargetRole } from '../../core/internal';

/** RNGH touch callback 中单个触点所需的最小、无运行时依赖的数据结构。 */
export type NativeTouchSample = Readonly<{
  id: string | number;
  x: number;
  y: number;
}>;

/**
 * RNGH 2.32 `TouchEventType` 的数值表示，以及便于不导入 RNGH 的调用方/测试使用的等价字符串。
 * `x`/`y` 已是 gesture view-local 坐标；adapter 有意不声明或读取 absolute 坐标。
 */
export type NativeTouchEvent = Readonly<{
  eventType: number | 'TOUCHES_DOWN' | 'TOUCHES_MOVE' | 'TOUCHES_UP' | 'TOUCHES_CANCELLED';
  pointerType: string;
  changedTouches: readonly NativeTouchSample[];
}>;

/** RNGH finalize 回调所需的最小状态形状；RNGH State.END 的数值是 5。 */
export type NativeFinalizeEvent = Readonly<{
  state: number | string;
}>;

export type NativeInputAdapter = Readonly<{
  handleTouches: (event: NativeTouchEvent) => void;
  handleFinalize: (event: NativeFinalizeEvent, success: boolean) => void;
  destroy: () => void;
  getActivePointerIds: () => readonly (string | number)[];
}>;

export type CreateNativeInputAdapterOptions = Readonly<{
  onInput: (input: NormalizedPointerInput) => void;
  resolveTargetRole: (hostLocalPoint: Readonly<{ x: number; y: number }>) => TargetRole | unknown;
  toHostLocal?: (
    viewLocalPoint: Readonly<{ x: number; y: number }>
  ) => Readonly<{ x: number; y: number }>;
  now?: () => number;
}>;

type NativePhase = NormalizedPointerInput['phase'];

function phaseFromEventType(eventType: NativeTouchEvent['eventType']): NativePhase | null {
  switch (eventType) {
    case 1:
    case 'TOUCHES_DOWN':
      return 'down';
    case 2:
    case 'TOUCHES_MOVE':
      return 'move';
    case 3:
    case 'TOUCHES_UP':
      return 'up';
    case 4:
    case 'TOUCHES_CANCELLED':
      return 'cancel';
    default:
      return null;
  }
}

function deviceFromPointerType(pointerType: string): InputDevice | null {
  switch (pointerType) {
    case 'TOUCH':
    case 'touch':
      return 'touch';
    case 'STYLUS':
    case 'pen':
      return 'pen';
    case 'MOUSE':
    case 'mouse':
      return 'mouse';
    case 'KEY':
    case 'OTHER':
    default:
      return null;
  }
}

function validRole(value: unknown): TargetRole {
  return value === 'paper' ||
    value === 'ruler' ||
    value === 'selection' ||
    value === 'safe-control' ||
    value === 'none'
    ? value
    : 'none';
}

function isEndState(state: NativeFinalizeEvent['state']): boolean {
  return state === 5 || state === 'END';
}

function freezeInput(input: NormalizedPointerInput): NormalizedPointerInput {
  return Object.freeze({
    ...input,
    screen: Object.freeze({ ...input.screen }),
    modifiers: Object.freeze({ ...input.modifiers }),
  });
}

/**
 * 将 RNGH touch callbacks 翻译为 core 输入。该层不依赖 React、React Native、RNGH 或
 * Reanimated；外层需在 JS 上调用它，以便维持可测试、不可变的离散 pointer 生命周期。
 */
export function createNativeInputAdapter(
  options: CreateNativeInputAdapterOptions
): NativeInputAdapter {
  const active = new Map<NativeTouchSample['id'], NormalizedPointerInput>();
  const now = options.now ?? Date.now;
  const toHostLocal = options.toHostLocal ?? ((point) => point);
  let destroyed = false;

  const emit = (input: NormalizedPointerInput): NormalizedPointerInput | null => {
    if (!isNormalizedPointerInput(input)) {
      return null;
    }
    // 输出与缓存均为深至 Point/modifiers 的冻结副本，不引用 callback 的可变触点对象。
    const snapshot = freezeInput(input);
    options.onInput(snapshot);
    return snapshot;
  };

  const cancelActive = (
    pointerId: NativeTouchSample['id'],
    phase: Extract<NativePhase, 'up' | 'cancel'>
  ) => {
    const last = active.get(pointerId);
    if (!last) {
      return;
    }
    active.delete(pointerId);
    emit({ ...last, phase });
  };

  return Object.freeze({
    handleTouches: (event) => {
      if (destroyed) {
        return;
      }
      const phase = phaseFromEventType(event.eventType);
      const device = deviceFromPointerType(event.pointerType);
      if (!phase || !device) {
        return;
      }

      for (const touch of event.changedTouches) {
        if (phase === 'down' && active.has(touch.id)) {
          continue;
        }
        if (phase !== 'down' && !active.has(touch.id)) {
          continue;
        }

        if (phase === 'up' || phase === 'cancel') {
          const previous = active.get(touch.id);
          if (!previous) {
            continue;
          }
          const screen = toHostLocal({ x: touch.x, y: touch.y });
          const input: NormalizedPointerInput = {
            ...previous,
            phase,
            screen: { x: screen.x, y: screen.y },
            timestamp: now(),
          };
          emit(input);
          // 结束样本即使因异常坐标/时钟被守卫拒绝，也不能遗留活跃 pointer。
          active.delete(touch.id);
          continue;
        }

        const screen = toHostLocal({ x: touch.x, y: touch.y });
        const previous = active.get(touch.id);
        const input: NormalizedPointerInput = {
          phase,
          pointerId: touch.id,
          device: previous?.device ?? device,
          screen: { x: screen.x, y: screen.y },
          timestamp: now(),
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          targetRole:
            previous?.targetRole ??
            validRole(options.resolveTargetRole({ x: screen.x, y: screen.y })),
        };
        const snapshot = emit(input);
        if (!snapshot) {
          continue;
        }
        active.set(touch.id, snapshot);
      }
    },
    handleFinalize: (event, success) => {
      if (destroyed) {
        return;
      }
      const phase: Extract<NativePhase, 'up' | 'cancel'> =
        success === true && isEndState(event.state) ? 'up' : 'cancel';
      [...active.keys()].forEach((pointerId) => {
        cancelActive(pointerId, phase);
      });
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      [...active.keys()].forEach((pointerId) => {
        cancelActive(pointerId, 'cancel');
      });
      destroyed = true;
    },
    getActivePointerIds: () => Object.freeze([...active.keys()]),
  });
}
