import { isNormalizedPointerInput } from '../../core/internal';
import type { NormalizedPointerInput, Point, TargetRole } from '../../core/internal';
import { resolveTargetRole } from './resolveTargetRole';

export type NormalizePointerInputOptions = Readonly<{
  host: HTMLElement;
  now?: () => number;
  /** legacy capture 接缝已完成 content-box 转换时传入，避免重复读取/解释 DOM rect。 */
  point?: Point;
  /** 手势 controller 在 down-time 完成业务命中后可传入明确 core role。 */
  targetRole?: TargetRole | unknown;
  /** lost capture 等非标准 DOM 生命周期可安全映射为既有 core phase。 */
  phase?: NormalizedPointerInput['phase'];
  resolveTargetRole?: (eventTarget: EventTarget | null, host: HTMLElement) => TargetRole | unknown;
}>;

function phaseFromEventType(type: string): NormalizedPointerInput['phase'] | null {
  switch (type) {
    case 'pointerdown':
      return 'down';
    case 'pointermove':
      return 'move';
    case 'pointerup':
      return 'up';
    case 'pointercancel':
      return 'cancel';
    default:
      return null;
  }
}

function knownDevice(pointerType: string): NormalizedPointerInput['device'] | null {
  return pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen'
    ? pointerType
    : null;
}

function nonNegativeInteger(value: number): number | undefined {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function pressure(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
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

function validPoint(value: Point): Point | null {
  return Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
}

/**
 * 提取不依赖 DOM 事件对象的 core 输入。任何不能完整表达为 `NormalizedPointerInput` 的平台
 * 样本都被拒绝，而不是以猜测值进入 reducer。
 */
export function normalizePointerInput(
  event: PointerEvent,
  options: NormalizePointerInputOptions
): NormalizedPointerInput | null {
  const phase = options.phase ?? phaseFromEventType(event.type);
  const device = knownDevice(event.pointerType);
  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : options.now?.();
  const resolver = options.resolveTargetRole ?? resolveTargetRole;

  if (phase === null || device === null || timestamp === undefined || !Number.isFinite(timestamp)) {
    return null;
  }

  const rect = options.host.getBoundingClientRect();
  const screen = validPoint(
    options.point ?? {
      x: event.clientX - rect.left - options.host.clientLeft,
      y: event.clientY - rect.top - options.host.clientTop,
    }
  );
  if (screen === null) {
    return null;
  }
  const normalizedPressure = pressure(event.pressure);
  const button = nonNegativeInteger(event.button);
  const buttons = nonNegativeInteger(event.buttons);
  const input: NormalizedPointerInput = {
    phase,
    pointerId: event.pointerId,
    device,
    screen,
    timestamp,
    modifiers: {
      alt: event.altKey === true,
      ctrl: event.ctrlKey === true,
      meta: event.metaKey === true,
      shift: event.shiftKey === true,
    },
    ...(normalizedPressure === undefined ? {} : { pressure: normalizedPressure }),
    ...(button === undefined ? {} : { button }),
    ...(buttons === undefined ? {} : { buttons }),
    targetRole: validRole(
      options.targetRole === undefined ? resolver(event.target, options.host) : options.targetRole
    ),
  };

  return isNormalizedPointerInput(input) ? input : null;
}
