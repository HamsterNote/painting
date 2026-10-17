/** @jest-environment node */

/**
 * Task 2.3 证据：begin 时压力模式解析（resolvePressureMode）。
 *
 * 范围声明（重要）：
 * - 本测试只验证 document.ts 中的纯函数 resolver 在“落笔解析（begin）”时的来源/能力路由，
 *   以及显式模式锁定。
 * - resolver 的入参只有 (requestedMode, source, capability)，**不读取压力值**。
 *   因此下方 fixture 保留“真实压力序列”，用于证明解析结果与压力大小/变化率无关；
 *   本测试**不**宣称 controller 在 mid-stroke 已按解析结果执行模拟（那是 2.4 的几何验证范围）。
 * - 本文件不修改任何生产代码，仅新增测试。
 */

import {
  resolvePressureMode,
  type InputSource,
  type PressureCapability,
  type PressureMode,
  type ResolvedPressureMode,
} from '../../model/document';

/** 真实接受的原始样本（保留原始压力，仅用于 fixture 说明，不进入 resolver）。 */
type FixtureSample = Readonly<{
  sequence: number;
  x: number;
  y: number;
  pressure?: number;
  time: number;
  phase: 'down' | 'move' | 'up';
  source: InputSource;
}>;

/**
 * 构造一段保留真实压力序列的 fixture。
 * 压力值可能恒为 0.5、为正、为 0 或剧烈变化——这些都不应影响 begin 解析结果。
 */
function makePressureFixture(source: InputSource, pressures: readonly number[]): readonly FixtureSample[] {
  return pressures.map((pressure, index) => ({
    sequence: index,
    x: index * 2,
    y: index,
    pressure,
    time: index * 8,
    phase: index === 0 ? 'down' : index === pressures.length - 1 ? 'up' : 'move',
    source,
  }));
}

// 常见真实压力序列：恒定 0.5（spec 场景）、正压力、明显变化率、零压力。
const CONSTANT_HALF = [0.5, 0.5, 0.5] as const;
const POSITIVE = [0.8, 0.9, 0.75] as const;
const VARYING_RATE = [0.05, 0.95, 0.2] as const;
const ZERO = [0, 0, 0] as const;

const ALL_SOURCES: readonly InputSource[] = ['mouse', 'touch', 'pen', 'native'];
const ALL_CAPABILITIES: readonly PressureCapability[] = ['available', 'unavailable', 'unknown'];
const ALL_EXPLICIT_MODES: readonly Exclude<PressureMode, 'auto'>[] = ['real', 'simulated', 'constant'];

describe('resolvePressureMode: auto 来源/能力路由（begin 解析）', () => {
  it('pen + available/unknown 恒 0.5 仍解析为 real；unavailable 解析为 simulated', () => {
    const constantHalf = makePressureFixture('pen', CONSTANT_HALF);
    // fixture 保留真实压力序列，此处仅以此笔触代表“pen 落在画布上”。
    expect(constantHalf.every((sample) => sample.pressure === 0.5)).toBe(true);

    expect(resolvePressureMode('auto', 'pen', 'available')).toBe('real');
    expect(resolvePressureMode('auto', 'pen', 'unknown')).toBe('real');
    expect(resolvePressureMode('auto', 'pen', 'unavailable')).toBe('simulated');
  });

  it('mouse/touch + available/unknown 即使报告正压力仍解析为 simulated', () => {
    const positiveMouse = makePressureFixture('mouse', POSITIVE);
    const positiveTouch = makePressureFixture('touch', POSITIVE);
    expect(positiveMouse.some((sample) => (sample.pressure ?? 0) > 0)).toBe(true);
    expect(positiveTouch.some((sample) => (sample.pressure ?? 0) > 0)).toBe(true);

    for (const capability of ['available', 'unknown'] as const) {
      expect(resolvePressureMode('auto', 'mouse', capability)).toBe('simulated');
      expect(resolvePressureMode('auto', 'touch', capability)).toBe('simulated');
    }
  });

  it('native + available 解析为 real；unavailable/unknown 解析为 simulated', () => {
    expect(resolvePressureMode('auto', 'native', 'available')).toBe('real');
    expect(resolvePressureMode('auto', 'native', 'unavailable')).toBe('simulated');
    expect(resolvePressureMode('auto', 'native', 'unknown')).toBe('simulated');
  });
});

describe('resolvePressureMode: 显式模式对 source/capability 全量锁定', () => {
  it('real/simulated/constant 在任意来源与能力下原样返回', () => {
    for (const mode of ALL_EXPLICIT_MODES) {
      for (const source of ALL_SOURCES) {
        for (const capability of ALL_CAPABILITIES) {
          const resolved: ResolvedPressureMode = resolvePressureMode(mode, source, capability);
          expect(resolved).toBe(mode);
        }
      }
    }
  });
});

describe('resolvePressureMode: 不依据 p>0 或变化率判定', () => {
  it('同来源/能力下，恒定 0.5、正压力、剧变、零压力得到同一结果', () => {
    const fixtures: readonly (readonly FixtureSample[])[] = [
      makePressureFixture('pen', CONSTANT_HALF),
      makePressureFixture('pen', POSITIVE),
      makePressureFixture('pen', VARYING_RATE),
      makePressureFixture('pen', ZERO),
    ];

    const penAvailable = fixtures.map(() => resolvePressureMode('auto', 'pen', 'available'));
    const penUnavailable = fixtures.map(() => resolvePressureMode('auto', 'pen', 'unavailable'));
    const mouseUnknown = fixtures.map(() => resolvePressureMode('auto', 'mouse', 'unknown'));

    // 全部为 real / 全部为 simulated / 全部为 simulated —— 压力序列未参与解析。
    expect(penAvailable).toEqual(['real', 'real', 'real', 'real']);
    expect(penUnavailable).toEqual(['simulated', 'simulated', 'simulated', 'simulated']);
    expect(mouseUnknown).toEqual(['simulated', 'simulated', 'simulated', 'simulated']);
  });

  it('resolver 仅接受 (mode, source, capability) 三个参数，无压力入参', () => {
    // 以 function.length 固化签名：不存在第四位 pressure 参数。
    expect(resolvePressureMode.length).toBe(3);
  });
});
