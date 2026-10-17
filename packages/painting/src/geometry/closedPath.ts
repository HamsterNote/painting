/**
 * 共享闭合路径命令（Task 2.5）。
 *
 * 设计约束（design.md 决策 3）：
 * - 首期只把 PF polygon 转成“单一闭合轮廓”的直接 M/L/Z 命令，**不再加自有平滑、不做 Q 曲线拟合**。
 * - Canvas Path2D 与 SVG `d` 使用同一命令序列；两端不得各自拟合。
 * - 填充规则固定为 nonzero（由渲染端执行；本模块只输出拓扑）。
 * - 回放目标只要求 moveTo/lineTo/closePath，**不含 beginPath**：真实 `Path2D` 可直接使用，
 *   重置路径由 Canvas context 调用方负责；本期尚无 render 实现，不宣称像素/填充已验证。
 * - 本模块不引用 DOM/Canvas/SVG 运行时类型，只定义结构性 target 接口，便于 node 环境测试。
 */

import type { Point } from '../model/document';

/** 断言顶点有限，避免 NaN/Infinity 进入路径命令（不改变坐标与 path 格式）。 */
function assertFinitePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(
      `polygon vertex must be finite, received (${String(point.x)}, ${String(point.y)})`
    );
  }
}

/** 单一闭合轮廓命令；moveTo 开头、closePath 收尾。 */
export type ClosedPathCommand =
  | Readonly<{ kind: 'moveTo'; x: number; y: number }>
  | Readonly<{ kind: 'lineTo'; x: number; y: number }>
  | Readonly<{ kind: 'closePath' }>;

/**
 * 结构化回放目标：只要求 moveTo/lineTo/closePath 三个原语。
 *
 * - **不包含 `beginPath`**：Canvas2D 的 `Path2D` 没有该方法，把它留在接口里会让
 *   真实 `Path2D` 无法满足本类型。因此回放不再负责重置路径。
 * - `CanvasRenderingContext2D` 调用方需要在调用 `replayClosedPath` 前自行 `beginPath()`；
 *   离线 `Path2D` 则可以直接作为 target 使用。
 * - 不导入 DOM `CanvasRenderingContext2D`，保持平台无关；但刻意与 DOM `Path2D`
 *   的结构形状保持兼容（见回归测试中的编译期 assignability 证据）。
 */
export interface ClosedPathTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/**
 * 把 polygon 顶点直接转成单一闭合路径命令。
 *
 * - 空 polygon → 空命令数组（不产生 `M`/`Z`）。
 * - 单点 polygon → `moveTo` + `closePath`（PF 单点会给出有效 dot 轮廓）。
 * - 非有限顶点 → 抛 `TypeError`（不改变 path 格式，只拒绝非法输入）。
 * - 不做 Q/曲线拟合，顶点坐标原样保留。
 */
export function polygonToClosedPathCommands(
  polygon: readonly Point[]
): readonly ClosedPathCommand[] {
  if (polygon.length === 0) {
    return Object.freeze([] as ClosedPathCommand[]);
  }

  const commands: ClosedPathCommand[] = [];
  polygon.forEach((point, index) => {
    assertFinitePoint(point);
    commands.push(
      index === 0
        ? Object.freeze({ kind: 'moveTo' as const, x: point.x, y: point.y })
        : Object.freeze({ kind: 'lineTo' as const, x: point.x, y: point.y })
    );
  });
  commands.push(Object.freeze({ kind: 'closePath' as const }));

  return Object.freeze(commands);
}

/**
 * 把命令序列序列化为 SVG path `d` 字符串。
 *
 * - 空命令 → `''`（调用方据此不渲染 path）。
 * - 坐标使用 JS 默认数字转字符串，**不 round 精度**，避免两端出现不同路径。
 */
export function commandsToSvgPath(commands: readonly ClosedPathCommand[]): string {
  if (commands.length === 0) {
    return '';
  }

  const segments: string[] = [];
  for (const command of commands) {
    switch (command.kind) {
      case 'moveTo':
        segments.push(`M ${command.x} ${command.y}`);
        break;
      case 'lineTo':
        segments.push(`L ${command.x} ${command.y}`);
        break;
      case 'closePath':
        segments.push('Z');
        break;
    }
  }

  return segments.join(' ');
}

/**
 * 把同一命令序列回放到结构性 target（Canvas Path2D 等）。
 * 与 `commandsToSvgPath` 共享 commands，保证 Canvas/SVG 路径一致。
 *
 * **不调用 `beginPath`**：重置路径由调用方负责，这样真实 `Path2D`（无 `beginPath`）
 * 也能直接作为 target。本函数只输出拓扑命令，不执行填充。
 *
 * 填充规则（nonzero）由渲染端在填充时显式选择；本期尚无 render 实现，
 * 因此这里只保证命令序列一致，**不宣称**任何实际像素/填充结果已被验证。
 */
export function replayClosedPath(
  target: ClosedPathTarget,
  commands: readonly ClosedPathCommand[]
): void {
  for (const command of commands) {
    switch (command.kind) {
      case 'moveTo':
        target.moveTo(command.x, command.y);
        break;
      case 'lineTo':
        target.lineTo(command.x, command.y);
        break;
      case 'closePath':
        target.closePath();
        break;
    }
  }
}
