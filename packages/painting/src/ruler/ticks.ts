/**
 * Ruler 刻度生成模块 — 纯数学，不依赖 React / DOM。
 *
 * 约定：
 * - 中心刻度标签为 "0"
 * - 正标签向左右镜像对称（右侧为正方向）
 * - 不生成负数标签（-5 不出现，只出现 5 在左侧）
 * - 刻度总数受 ruler.length / spacing 约束，保证有界
 */

import type { RulerPoint, RulerTransform } from './geometry';
import { toCanvasPoint } from './geometry';

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 刻度类型：major（主刻度）或 minor（次刻度） */
export type TickKind = 'major' | 'minor';

/** 单个刻度的描述 */
export interface RulerTick {
  /** 刻度在画布坐标系中的位置（在 ruler 中心线上） */
  readonly canvasPoint: RulerPoint;
  /** 刻度在 ruler 本地坐标系中的 x 坐标（用于排序/调试） */
  readonly localX: number;
  /** 刻度类型 */
  readonly kind: TickKind;
  /** 刻度标签文本；minor 刻度可以为空字符串 */
  readonly label: string;
}

/** 刻度生成选项 */
export interface RulerTickOptions {
  /** 主刻度间距（ruler 本地坐标单位），必须 > 0 */
  readonly majorSpacing: number;
  /** 次刻度间距（ruler 本地坐标单位），必须 > 0 且 <= majorSpacing */
  readonly minorSpacing: number;
  /** 最大刻度数量上限，防止生成过多刻度；默认 200 */
  readonly maxTicks?: number;
}

// ─── 默认值 ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TICKS = 200;
const DEFAULT_MAJOR_SPACING = 50;
const DEFAULT_MINOR_SPACING = 10;

// ─── 核心逻辑 ────────────────────────────────────────────────────────────────

/**
 * 生成 ruler 上的刻度列表。
 *
 * 算法：
 * 1. 从中心（localX = 0）开始，向正方向以 minorSpacing 为步进生成刻度
 * 2. 向负方向镜像生成（标签使用绝对值，保证无负号）
 * 3. 中心刻度（localX = 0）标签固定为 "0"
 * 4. 每隔 majorSpacing 出现一个 major 刻度，其余为 minor
 * 5. 超出 ruler.length/2 范围的刻度不生成
 * 6. 总数超过 maxTicks 时截断
 *
 * 返回的数组按 localX 升序排列。
 */
export function generateTicks(
  ruler: RulerTransform,
  options?: Partial<RulerTickOptions>,
): readonly RulerTick[] {
  const majorSpacing = Math.max(1, options?.majorSpacing ?? DEFAULT_MAJOR_SPACING);
  const minorSpacing = Math.max(1, options?.minorSpacing ?? DEFAULT_MINOR_SPACING);
  const maxTicks = options?.maxTicks ?? DEFAULT_MAX_TICKS;

  // minorSpacing 不能大于 majorSpacing
  const effectiveMinor = Math.min(minorSpacing, majorSpacing);
  const halfLen = ruler.length / 2;

  const ticks: RulerTick[] = [];
  const seen = new Set<string>();

  // 内部辅助：添加一个刻度（去重）
  const addTick = (localX: number): boolean => {
    // 用四舍五入到 6 位小数做去重 key，避免浮点误差
    const key = localX.toFixed(6);
    if (seen.has(key)) return false;
    seen.add(key);

    // 判断是 major 还是 minor
    // major 条件：localX 是 majorSpacing 的整数倍（容差 1e-9）
    const distFromMajor = Math.abs(localX) % majorSpacing;
    const isMajor = distFromMajor < 1e-9 || Math.abs(distFromMajor - majorSpacing) < 1e-9;

    // 标签逻辑：中心为 "0"，其余为正数绝对值
    let label: string;
    if (Math.abs(localX) < 1e-9) {
      label = '0';
    } else {
      label = String(Math.round(Math.abs(localX)));
    }

    const canvasPoint = toCanvasPoint({ x: localX, y: 0 }, ruler);

    ticks.push({
      canvasPoint,
      localX,
      kind: isMajor ? 'major' : 'minor',
      label: isMajor ? label : '',
    });

    return true;
  };

  // 始终添加中心刻度
  addTick(0);

  // 向正方向生成
  for (let x = effectiveMinor; x <= halfLen + 1e-9; x += effectiveMinor) {
    if (ticks.length >= maxTicks) break;
    addTick(x);
  }

  // 向负方向镜像生成
  for (let x = -effectiveMinor; x >= -(halfLen + 1e-9); x -= effectiveMinor) {
    if (ticks.length >= maxTicks) break;
    addTick(x);
  }

  // 按 localX 升序排列
  ticks.sort((a, b) => a.localX - b.localX);

  return ticks;
}

// ─── 便捷默认值导出 ──────────────────────────────────────────────────────────

export const DEFAULT_TICK_OPTIONS: Required<RulerTickOptions> = {
  majorSpacing: DEFAULT_MAJOR_SPACING,
  minorSpacing: DEFAULT_MINOR_SPACING,
  maxTicks: DEFAULT_MAX_TICKS,
};
