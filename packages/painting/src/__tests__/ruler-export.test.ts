import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  constrainPointToRulerEdge,
  createRulerEdgeConstraint,
  DEFAULT_RULER_PIXELS_PER_INCH,
  generateRulerTicks,
  getInfiniteRulerLayout,
  isInsideRuler,
  millimetersToPixels,
  projectPointToRulerCenterline,
  projectPointToRulerEdge,
  rotateRulerAround,
  snapRulerRotation,
} from '@hamster-note/painting/ruler';

/**
 * `@hamster-note/painting/ruler` 是纯尺子几何的公开子路径。
 *
 * 正式 Web 候选编辑器必须经包级子路径引用，不得私有相对导入内部模块。
 * 本测试同时守住边界：
 *  1. 条件 exports 与 `./core` / `./skia` / `./input/web` 同构，任何条件都不为 null，
 *     且 react-native 条件直接落到真实 src 源码入口；
 *  2. geometry.ts 保持零 import 的纯数学，可跨端；
 *  3. 新的尺边/中线投影 API 只经该子路径暴露，不进入包根 barrel，
 *     也不把 DOM / legacy / Skia 牵连进来。
 *
 * 局限：这只验证纯几何可在 JS 环境运行；正式原生运行仍只是 compat-static，
 * 本测试不能作为 native 运行验证的依据。
 */

const packageRoot = resolve(process.cwd(), 'packages/painting');

interface ExportCondition {
  types?: string;
  default?: string;
}

interface PackageJson {
  exports: Record<string, Record<string, ExportCondition | null>>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageJson;
}

describe('@hamster-note/painting/ruler', () => {
  it('经公开子路径暴露必要的纯几何与刻度 API，而非包根 barrel', () => {
    // 尺边约束
    expect(createRulerEdgeConstraint).toBeDefined();
    expect(constrainPointToRulerEdge).toBeDefined();
    expect(projectPointToRulerEdge).toBeDefined();
    expect(projectPointToRulerCenterline).toBeDefined();
    // 无限尺布局与旋转
    expect(getInfiniteRulerLayout).toBeDefined();
    expect(rotateRulerAround).toBeDefined();
    expect(snapRulerRotation).toBeDefined();
    expect(isInsideRuler).toBeDefined();
    // 刻度
    expect(DEFAULT_RULER_PIXELS_PER_INCH).toBe(96);
    expect(millimetersToPixels).toBeDefined();
    expect(generateRulerTicks).toBeDefined();
  });

  it('几何 API 可在纯 JS 环境直接运行，无需 DOM 或 React 运行时', () => {
    // Given: 一把水平尺子。
    const ruler = { center: { x: 100, y: 100 }, length: 400, height: 40, rotationRad: 0 };

    // When: 从尺子上方跨入尺身并投影到最近的物理尺边。
    const constraint = createRulerEdgeConstraint({ x: 40, y: 60 }, ruler);
    const result = constrainPointToRulerEdge({ x: 70, y: 90 }, constraint);

    // Then: 跨入后吸附到上边 y=80，属于纯数学行为。
    expect(result.constraint.phase).toBe('constrained');
    expect(result.point).toEqual({ x: 70, y: 80 });
  });

  it('解析条件与 ./core、./skia、./input/web 同构，且任何条件都不为 null', () => {
    const { exports } = readPackageJson();
    const rulerExport = exports['./ruler'];

    expect(rulerExport).toBeDefined();

    // 与既有子路径同构：条件键集合一致。
    const referenceKeys = Object.keys(exports['./core']).sort();
    expect(Object.keys(rulerExport).sort()).toEqual(referenceKeys);
    expect(Object.keys(rulerExport).sort()).toEqual(Object.keys(exports['./layered']).sort());
    expect(exports).not.toHaveProperty('./skia');
    expect(Object.keys(rulerExport).sort()).toEqual(Object.keys(exports['./input/web']).sort());

    // 回归护栏：任一条件为 null 都会让携带该条件的解析器解析失败。
    for (const target of Object.values(rulerExport)) {
      expect(target).not.toBeNull();
    }
  });

  it('react-native 条件落到真实源码入口，import/require 指向 CJS/ESM 构件路径', () => {
    const { exports } = readPackageJson();
    const rulerExport = exports['./ruler'];

    expect(rulerExport['react-native']).toEqual({
      types: './lib/typescript/module/ruler/index.d.ts',
      default: './src/ruler/index.ts',
    });
    expect(rulerExport['import']).toEqual({
      types: './lib/typescript/module/ruler/index.d.ts',
      default: './lib/module/ruler/index.js',
    });
    expect(rulerExport['require']).toEqual({
      types: './lib/typescript/commonjs/ruler/index.d.ts',
      default: './lib/commonjs/ruler/index.js',
    });

    // 源码入口必须真实存在，解析才不会落空。
    const entry = (rulerExport['react-native'] as ExportCondition).default as string;
    expect(existsSync(join(packageRoot, entry))).toBe(true);
  });

  it('geometry.ts 保持零 import 的纯数学，子路径入口不牵连 DOM / legacy / Skia', () => {
    const geometrySource = readFileSync(join(packageRoot, 'src', 'ruler', 'geometry.ts'), 'utf8');
    // 纯数学契约：模块自身不得 import / require 任何东西。
    expect(geometrySource).not.toMatch(/^\s*import\b/m);
    expect(geometrySource).not.toMatch(/\brequire\(/);

    const indexSource = readFileSync(join(packageRoot, 'src', 'ruler', 'index.ts'), 'utf8');
    // 只允许从同目录纯模块导入，不得牵连 DOM / legacy / Skia / input 平台层。
    expect(indexSource).not.toMatch(/from ['"][^'"]*skia/);
    expect(indexSource).not.toMatch(/from ['"][^'"]*legacy/);
    expect(indexSource).not.toMatch(/from ['"][^'"]*input\//);
    // 深层私有导入（../）不能出现在对外入口。
    expect(indexSource).not.toMatch(/from ['"]\.\.\//);
  });

  it('新的尺边/中线投影 API 不进入包根 barrel，边界由子路径保证', () => {
    const rootEntry = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8');

    // 根 barrel 仍只保留历史的少量 ruler 导出，不扩散纯几何新 API。
    expect(rootEntry).not.toContain('createRulerEdgeConstraint');
    expect(rootEntry).not.toContain('projectPointToRulerCenterline');
    expect(rootEntry).not.toContain('projectPointToRulerEdge');
    expect(rootEntry).not.toContain("from './ruler/geometry'");
  });
});
