/**
 * 平台无关的二维 DIP 点。
 *
 * `NormalizedPointerInput.screen` 使用宿主局部 DIP，而不是设备像素、画布坐标或某个
 * 平台事件的全局坐标；坐标变换由后续 adapter/viewport 层负责。
 */
export type Point = Readonly<{
  x: number;
  y: number;
}>;

/** 离散 pointer 生命周期；不表达任何平台手势库的聚合会话协议。 */
export type InputPhase = 'down' | 'move' | 'up' | 'cancel';

/** 已由平台 adapter 明确识别的输入设备。adapter 不得把未知设备猜测成其中之一。 */
export type InputDevice = 'mouse' | 'touch' | 'pen';

/**
 * pointer 按下瞬间的命中角色。
 *
 * `paper` 是可绘制纸面，`ruler` 与 `selection` 分别是尺子和选框，`safe-control` 是
 * 必须与画布交互隔离的宿主安全控件，`none` 表示没有可交互命中目标。后两个角色不会
 * 获得 core 内的 pointer 归属。
 */
export type TargetRole = 'paper' | 'ruler' | 'selection' | 'safe-control' | 'none';

/** 所有修饰键始终显式出现，避免不同 adapter 以省略字段表达 false。 */
export type InputModifiers = Readonly<{
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}>;

/**
 * adapter 交给 core 的单个、已规范化 pointer 事件。
 *
 * 此对象只描述一个离散生命周期样本，不携带事件对象、回调或手势会话状态。`targetRole`
 * 由命中 adapter 填写；后续 move/up/cancel 的值不会改写按下时锁定的 ownership。
 */
export type NormalizedPointerInput = Readonly<{
  phase: InputPhase;
  pointerId: string | number;
  device: InputDevice;
  screen: Point;
  timestamp: number;
  modifiers: InputModifiers;
  pressure?: number;
  button?: number;
  buttons?: number;
  targetRole: TargetRole;
}>;

const phases: readonly InputPhase[] = ['down', 'move', 'up', 'cancel'];
const devices: readonly InputDevice[] = ['mouse', 'touch', 'pen'];
const targetRoles: readonly TargetRole[] = ['paper', 'ruler', 'selection', 'safe-control', 'none'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isInputPhase(value: unknown): value is InputPhase {
  return phases.includes(value as InputPhase);
}

function isInputDevice(value: unknown): value is InputDevice {
  return devices.includes(value as InputDevice);
}

function isTargetRole(value: unknown): value is TargetRole {
  return targetRoles.includes(value as TargetRole);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isModifiers(value: unknown): value is InputModifiers {
  return (
    isRecord(value) &&
    typeof value.alt === 'boolean' &&
    typeof value.ctrl === 'boolean' &&
    typeof value.meta === 'boolean' &&
    typeof value.shift === 'boolean'
  );
}

/**
 * 验证外部 adapter 的运行时输入边界。
 *
 * 该守卫拒绝非有限坐标、时间戳与数字 pointer ID，拒绝不完整的 modifiers，也拒绝未知
 * device，确保 core 不需要猜测平台数据。pressure 有值时限定为 [0, 1]；button/buttons
 * 是非负整数。它不克隆或冻结输入，因而保持为无副作用的判定函数。
 */
export function isNormalizedPointerInput(value: unknown): value is NormalizedPointerInput {
  if (!isRecord(value)) {
    return false;
  }

  const { pointerId, pressure, button, buttons } = value;
  return (
    isInputPhase(value.phase) &&
    (typeof pointerId === 'string' || isFiniteNumber(pointerId)) &&
    isInputDevice(value.device) &&
    isPoint(value.screen) &&
    isFiniteNumber(value.timestamp) &&
    isModifiers(value.modifiers) &&
    isTargetRole(value.targetRole) &&
    (pressure === undefined || (isFiniteNumber(pressure) && pressure >= 0 && pressure <= 1)) &&
    (button === undefined || (isFiniteInteger(button) && button >= 0)) &&
    (buttons === undefined || (isFiniteInteger(buttons) && buttons >= 0))
  );
}
