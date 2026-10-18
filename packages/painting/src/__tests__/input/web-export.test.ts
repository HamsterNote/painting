import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createFreehandWebAdapter } from '@hamster-note/painting/input/web';

/**
 * `@hamster-note/painting/input/web` 是仅供 Web 编辑器模块（`*.web.*`）引用的有界子路径。
 *
 * 历史教训：这里曾把 `react-native` 条件写成 `null`，本意是阻止原生解析；但 Expo
 * Metro Web 解析时同样会携带 `react-native` 条件，`null` 会让 Web 端直接解析失败。
 * 因此边界不能靠「条件解析失败」表达，而应保证：
 *  1. 子路径导出条件与 `./skia` 同构，Web 能解析到真实模块；
 *  2. 原生入口不引用该子路径——原生不受污染由使用范围保证，而非由导出禁令保证。
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

describe('@hamster-note/painting/input/web', () => {
  it('exports the bounded Web input adapter API without using the root barrel', () => {
    expect(createFreehandWebAdapter).toBeDefined();
  });

  it('解析条件与 ./skia 同构：react-native 指向真实 Web 源码，且任何条件都不为 null', () => {
    const { exports } = readPackageJson();
    const webExport = exports['./input/web'];
    const skiaExport = exports['./layered'];

    expect(webExport).toBeDefined();
    expect(skiaExport).toBeDefined();

    // 回归护栏：任一条件下为 null 都会让携带该条件的解析器（含 Expo Metro Web）解析失败。
    for (const target of Object.values(webExport)) {
      expect(target).not.toBeNull();
    }

    // 与 ./skia 同构：条件键集合一致，react-native 条件同样直接落到 src 源码入口。
    expect(Object.keys(webExport).sort()).toEqual(Object.keys(skiaExport).sort());
    expect(webExport['react-native']).toEqual({
      types: './lib/typescript/module/input/web/index.d.ts',
      default: './src/input/web/index.ts',
    });

    // 源码入口必须真实存在，解析才不会落空。
    const entry = (webExport['react-native'] as ExportCondition).default as string;
    expect(existsSync(join(packageRoot, entry))).toBe(true);
  });

  it('原生入口不引用该子路径：边界由使用范围保证，而非让原生解析失败', () => {
    const nativeEntry = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8');
    expect(nativeEntry).not.toContain('input/web');
  });
});
