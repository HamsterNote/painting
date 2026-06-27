/**
 * Ruler 几何与刻度测试。
 *
 * 覆盖：
 * - 坐标转换往返一致性
 * - 点在 ruler 内/外判断
 * - 水平 ruler 投影（投影后 y == center.y）
 * - 外部点返回 null
 * - 30° 旋转 ruler 投影到旋转中心线（容差内）
 * - 刻度标签：中心 "0"，正标签镜像，无负标签
 * - 刻度数量有界
 */

import type { RulerTransform } from '../geometry';
import {
  toLocalPoint,
  toCanvasPoint,
  isInsideRuler,
  projectOntoRuler,
  degToRad,
} from '../geometry';
import { generateTicks } from '../ticks';
import type { RulerTick } from '../ticks';

// ─── 测试用 ruler 便利构造 ────────────────────────────────────────────────────

/** 创建一个水平、以指定中心为原点的 ruler */
function makeHorizontalRuler(
  cx: number,
  cy: number,
  length = 400,
  height = 40,
): RulerTransform {
  return { center: { x: cx, y: cy }, rotationRad: 0, length, height };
}

/** 创建一个旋转指定度数的 ruler */
function makeRotatedRuler(
  cx: number,
  cy: number,
  deg: number,
  length = 400,
  height = 40,
): RulerTransform {
  return { center: { x: cx, y: cy }, rotationRad: degToRad(deg), length, height };
}

// ─── 坐标转换 ────────────────────────────────────────────────────────────────

describe('ruler geometry - coordinate transforms', () => {
  const ruler = makeHorizontalRuler(200, 300);

  it('toLocalPoint 将画布原点附近的点转换为本地坐标', () => {
    // center=(200,300), 无旋转，点 (220,310) → 本地 (20, 10)
    const local = toLocalPoint({ x: 220, y: 310 }, ruler);
    expect(local.x).toBeCloseTo(20, 6);
    expect(local.y).toBeCloseTo(10, 6);
  });

  it('toCanvasPoint 将本地坐标转换回画布坐标', () => {
    const canvas = toCanvasPoint({ x: 20, y: 10 }, ruler);
    expect(canvas.x).toBeCloseTo(220, 6);
    expect(canvas.y).toBeCloseTo(310, 6);
  });

  it('往返转换保持一致（水平 ruler）', () => {
    const original = { x: 250, y: 320 };
    const local = toLocalPoint(original, ruler);
    const back = toCanvasPoint(local, ruler);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
  });

  it('往返转换保持一致（30° 旋转 ruler）', () => {
    const rotatedRuler = makeRotatedRuler(100, 100, 30);
    const original = { x: 150, y: 120 };
    const local = toLocalPoint(original, rotatedRuler);
    const back = toCanvasPoint(local, rotatedRuler);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
  });

  it('中心点的本地坐标为原点', () => {
    const local = toLocalPoint({ x: 200, y: 300 }, ruler);
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.y).toBeCloseTo(0, 6);
  });
});

// ─── 点在 ruler 内判断 ────────────────────────────────────────────────────────

describe('ruler geometry - isInsideRuler', () => {
  const ruler = makeHorizontalRuler(200, 300, 400, 40);

  it('中心点在 ruler 内', () => {
    expect(isInsideRuler({ x: 200, y: 300 }, ruler)).toBe(true);
  });

  it('ruler 边界上的点在 ruler 内（<= 判断）', () => {
    // 右边缘：localX = 200, localY = 0
    expect(isInsideRuler({ x: 400, y: 300 }, ruler)).toBe(true);
    // 上边缘：localX = 0, localY = -20
    expect(isInsideRuler({ x: 200, y: 280 }, ruler)).toBe(true);
  });

  it('ruler 外部的点不在 ruler 内', () => {
    // 超出右边界
    expect(isInsideRuler({ x: 500, y: 300 }, ruler)).toBe(false);
    // 超出上边界
    expect(isInsideRuler({ x: 200, y: 200 }, ruler)).toBe(false);
  });

  it('30° 旋转 ruler 内部点判断正确', () => {
    const rotatedRuler = makeRotatedRuler(200, 300, 30, 400, 40);
    // 中心点始终在内部
    expect(isInsideRuler({ x: 200, y: 300 }, rotatedRuler)).toBe(true);
    // 远处的点在外部
    expect(isInsideRuler({ x: 500, y: 500 }, rotatedRuler)).toBe(false);
  });
});

// ─── 投影 ────────────────────────────────────────────────────────────────────

describe('ruler geometry - projectOntoRuler', () => {
  it('水平 ruler：内部点投影后 y == center.y', () => {
    const ruler = makeHorizontalRuler(200, 300, 400, 40);
    // 点在 ruler 内部偏右上方
    const canvasPoint = { x: 220, y: 310 };
    const projected = projectOntoRuler(canvasPoint, ruler);

    expect(projected).not.toBeNull();
    // 投影后 y 应该等于 center.y（在中心线上）
    expect(projected!.y).toBeCloseTo(300, 6);
    // x 应该被 clamp 到 ruler 范围内，但 220 在范围内所以 x == 220
    expect(projected!.x).toBeCloseTo(220, 6);
  });

  it('外部点返回 null', () => {
    const ruler = makeHorizontalRuler(200, 300, 400, 40);
    // 完全在 ruler 外部
    const projected = projectOntoRuler({ x: 600, y: 600 }, ruler);
    expect(projected).toBeNull();
  });

  it('超出右端的内部点被 clamp 到右端', () => {
    const ruler = makeHorizontalRuler(200, 300, 400, 40);
    // localX = 250，超出 halfLen=200，但仍在 height 范围内
    // y 需要在 [280, 320] 范围内
    const canvasPoint = { x: 450, y: 300 }; // localX=250, localY=0
    const projected = projectOntoRuler(canvasPoint, ruler);

    // 点 (450, 300) 的 localX=250 > halfLen=200，但仍 |localY|=0 <= halfH=20
    // 所以 isInsideRuler 应该为 false（|localX|=250 > 200）
    expect(projected).toBeNull();
  });

  it('边界点投影时 localX 被限制在 [-length/2, length/2]', () => {
    const ruler = makeHorizontalRuler(200, 300, 400, 40);

    const rightEdgeProjection = projectOntoRuler({ x: 400, y: 310 }, ruler);
    const leftEdgeProjection = projectOntoRuler({ x: 0, y: 290 }, ruler);

    expect(rightEdgeProjection).not.toBeNull();
    expect(leftEdgeProjection).not.toBeNull();
    if (!rightEdgeProjection || !leftEdgeProjection) {
      throw new Error('Expected ruler edge projections to exist');
    }
    const rightLocal = toLocalPoint(rightEdgeProjection, ruler);
    const leftLocal = toLocalPoint(leftEdgeProjection, ruler);
    expect(rightLocal.x).toBeCloseTo(ruler.length / 2, 6);
    expect(rightLocal.y).toBeCloseTo(0, 6);
    expect(leftLocal.x).toBeCloseTo(-ruler.length / 2, 6);
    expect(leftLocal.y).toBeCloseTo(0, 6);
  });

  it('30° 旋转 ruler：内部点投影到旋转中心线（容差内）', () => {
    const ruler = makeRotatedRuler(200, 300, 30, 400, 40);

    // 构造一个本地坐标为 (50, 5) 的点 → 画布坐标
    const localInput = { x: 50, y: 5 };
    const canvasPoint = toCanvasPoint(localInput, ruler);

    // 投影
    const projected = projectOntoRuler(canvasPoint, ruler);
    expect(projected).not.toBeNull();

    // 预期投影后的本地坐标为 (50, 0)
    const projectedLocal = toLocalPoint(projected!, ruler);
    expect(projectedLocal.x).toBeCloseTo(50, 4);
    expect(projectedLocal.y).toBeCloseTo(0, 4);

    // 验证投影点在 ruler 中心线上：
    // 从 center 到 projected 的向量应与 ruler 方向向量平行
    const dx = projected!.x - ruler.center.x;
    const dy = projected!.y - ruler.center.y;
    const dirX = Math.cos(ruler.rotationRad);
    const dirY = Math.sin(ruler.rotationRad);
    // 叉积应接近 0（平行）
    const cross = dx * dirY - dy * dirX;
    expect(Math.abs(cross)).toBeLessThan(1e-4);
  });

  it('30° 旋转 ruler：外部点返回 null', () => {
    const ruler = makeRotatedRuler(200, 300, 30, 400, 40);
    const projected = projectOntoRuler({ x: 600, y: 600 }, ruler);
    expect(projected).toBeNull();
  });
});

// ─── 角度工具 ────────────────────────────────────────────────────────────────

describe('ruler geometry - angle utilities', () => {
  it('degToRad 正确转换', () => {
    expect(degToRad(0)).toBeCloseTo(0, 10);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
    expect(degToRad(30)).toBeCloseTo(Math.PI / 6, 10);
  });
});

// ─── 刻度生成 ────────────────────────────────────────────────────────────────

describe('ruler ticks - generateTicks', () => {
  const ruler = makeHorizontalRuler(200, 300, 400, 40);

  it('中心刻度标签为 "0"', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    const centerTick = ticks.find((t) => Math.abs(t.localX) < 1e-6);
    expect(centerTick).toBeDefined();
    expect(centerTick!.label).toBe('0');
    expect(centerTick!.kind).toBe('major');
  });

  it('所有标签不含负号', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    for (const tick of ticks) {
      expect(tick.label).not.toMatch(/-/);
    }
  });

  it('左右对称的 major 刻度标签相同（正数）', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    const majorTicks = ticks.filter((t) => t.kind === 'major');

    // 收集正方向和负方向的标签
    const positiveLabels = majorTicks
      .filter((t) => t.localX > 1e-6)
      .map((t) => t.label);
    const negativeLabels = majorTicks
      .filter((t) => t.localX < -1e-6)
      .map((t) => t.label);

    // 两侧的标签集合应该相同（镜像）
    expect(positiveLabels.sort()).toEqual(negativeLabels.sort());

    // 所有非零标签应该是正数字符串
    for (const label of positiveLabels) {
      expect(Number(label)).toBeGreaterThan(0);
    }
  });

  it('major 刻度间距正确（50 单位间隔）', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    const majorTicks = ticks.filter((t) => t.kind === 'major');
    // ruler length=400, halfLen=200, majorSpacing=50 → 应有 0, ±50, ±100, ±150, ±200
    // 共 9 个 major 刻度
    expect(majorTicks.length).toBe(9);
  });

  it('刻度数量有界（默认 length=400 不超过 maxTicks）', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    // length=400, minorSpacing=10 → 最多 400/10 + 1 = 41 个刻度
    expect(ticks.length).toBeLessThanOrEqual(200);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('maxTicks 限制生效', () => {
    const ticks = generateTicks(ruler, {
      majorSpacing: 50,
      minorSpacing: 10,
      maxTicks: 5,
    });
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('刻度按 localX 升序排列', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].localX).toBeGreaterThanOrEqual(ticks[i - 1].localX);
    }
  });

  it('minor 刻度标签为空字符串', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    const minorTicks = ticks.filter((t) => t.kind === 'minor');
    for (const tick of minorTicks) {
      expect(tick.label).toBe('');
    }
  });

  it('所有刻度的 canvasPoint 在 ruler 中心线上', () => {
    const ticks = generateTicks(ruler, { majorSpacing: 50, minorSpacing: 10 });
    for (const tick of ticks) {
      // 水平 ruler 的中心线 y == center.y
      expect(tick.canvasPoint.y).toBeCloseTo(300, 6);
    }
  });

  it('旋转 ruler 的刻度 canvasPoint 在旋转中心线上', () => {
    const rotatedRuler = makeRotatedRuler(200, 300, 30, 400, 40);
    const ticks = generateTicks(rotatedRuler, { majorSpacing: 50, minorSpacing: 10 });

    for (const tick of ticks) {
      // 验证：从 center 到 tick.canvasPoint 的向量与 ruler 方向平行（叉积≈0）
      const dx = tick.canvasPoint.x - rotatedRuler.center.x;
      const dy = tick.canvasPoint.y - rotatedRuler.center.y;
      const dirX = Math.cos(rotatedRuler.rotationRad);
      const dirY = Math.sin(rotatedRuler.rotationRad);
      const cross = dx * dirY - dy * dirX;
      expect(Math.abs(cross)).toBeLessThan(1e-4);
    }
  });
});
