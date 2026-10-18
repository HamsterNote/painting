/** @jest-environment node */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

import {
  addStroke,
  clearStrokes,
  readDrawingDocument,
  removeStroke,
  updateStroke,
} from '../../core/document';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

const sourceRoot = resolve(process.cwd(), 'packages/painting/src');
const sourceExtensions = ['.ts', '.tsx'] as const;

function pen(id: string, x = 0): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'pen',
    points: [{ x, y: 0 }],
  };
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

function resolveRelativeModule(importer: string, specifier: string): string {
  const candidate = resolve(dirname(importer), specifier);
  const paths = [
    ...sourceExtensions.map((extension) => `${candidate}${extension}`),
    ...sourceExtensions.map((extension) => join(candidate, `index${extension}`)),
  ];
  const resolvedPath = paths.find(existsSync);

  if (!resolvedPath) {
    throw new Error(`Unable to resolve ${specifier} from ${importer}`);
  }

  return resolvedPath;
}

type CoreImportGraph = Readonly<{
  externalSpecifiers: readonly string[];
  sourceFiles: readonly string[];
}>;

function collectCoreImportGraph(
  entryFiles: readonly string[],
  includeTypes = true
): CoreImportGraph {
  const visited = new Set<string>();
  const externalSpecifiers: string[] = [];

  function visit(filePath: string): void {
    if (visited.has(filePath)) {
      return;
    }

    visited.add(filePath);
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const module = statement.moduleSpecifier;
      if (!module || !ts.isStringLiteral(module)) continue;
      if (!includeTypes) {
        if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause;
          if (clause?.isTypeOnly) continue;
          const bindings = clause?.namedBindings;
          if (
            !clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.every((entry) => entry.isTypeOnly)
          )
            continue;
        } else if (statement.isTypeOnly) continue;
      }
      const specifier = module.text;
      if (specifier.startsWith('.')) {
        visit(resolveRelativeModule(filePath, specifier));
      } else {
        externalSpecifiers.push(specifier);
      }
    }
  }

  entryFiles.forEach((file) => {
    visit(join(sourceRoot, 'core', file));
  });
  return { externalSpecifiers, sourceFiles: [...visited] };
}

describe('core/document', () => {
  it('reads V1 and explicit V2 inputs into independent V2 documents without mutating either input', () => {
    const v1 = {
      strokes: [
        {
          id: 'legacy',
          tool: 'pen',
          points: [{ x: 1, y: 2, pressure: 0.5 }],
          dashArray: [2, 4],
        },
      ],
    };
    const v2 = documentWith(pen('current', 3));
    const v1BeforeRead = JSON.parse(JSON.stringify(v1));
    const v2BeforeRead = JSON.parse(JSON.stringify(v2));

    const v1Result = readDrawingDocument(v1);
    const v2Result = readDrawingDocument(v2);

    expect(v1).toEqual(v1BeforeRead);
    expect(v2).toEqual(v2BeforeRead);
    expect(v1Result).toMatchObject({
      document: { schemaVersion: 2, strokes: [{ id: 'legacy', schemaVersion: 2 }] },
      diagnostics: [],
    });
    expect(v2Result).toMatchObject({
      document: { schemaVersion: 2, strokes: [{ id: 'current', schemaVersion: 2 }] },
      diagnostics: [],
    });
    expect(v1Result.document).not.toBe(v1);
    expect(v1Result.document.strokes[0]).not.toBe(v1.strokes[0]);
    expect(v2Result.document).not.toBe(v2);
    expect(v2Result.document.strokes[0]).not.toBe(v2.strokes[0]);
  });

  it('reports future schemas while safely returning a normalized V2 document', () => {
    const futureDocument = {
      schemaVersion: 99,
      strokes: [{ ...pen('future'), schemaVersion: 99 }],
    };
    const beforeRead = JSON.parse(JSON.stringify(futureDocument));

    const result = readDrawingDocument(futureDocument);

    expect(futureDocument).toEqual(beforeRead);
    expect(result.document).toEqual(documentWith(pen('future')));
    expect(result.diagnostics).toEqual([{ type: 'unsupported-schema-version', schemaVersion: 99 }]);
  });

  it('adds, updates, removes, and clears immutably while preserving order and unchanged identities', () => {
    const first = pen('first');
    const second = pen('second');
    const initial = documentWith(first, second);
    const addedStroke = pen('third');

    const added = addStroke(initial, addedStroke);
    expect(added).not.toBe(initial);
    expect(added.strokes).not.toBe(initial.strokes);
    expect(added.strokes.map(({ id }) => id)).toEqual(['first', 'second', 'third']);
    expect(added.strokes[0]).toBe(first);
    expect(added.strokes[1]).toBe(second);
    expect(added.strokes[2]).not.toBe(addedStroke);
    expect(initial).toEqual(documentWith(first, second));

    const replacement = pen('second', 10);
    const updated = updateStroke(added, replacement);
    expect(updated).not.toBe(added);
    expect(updated.strokes).not.toBe(added.strokes);
    expect(updated.strokes.map(({ id }) => id)).toEqual(['first', 'second', 'third']);
    expect(updated.strokes[0]).toBe(first);
    expect(updated.strokes[1]).not.toBe(added.strokes[1]);
    expect(updated.strokes[1]).not.toBe(replacement);
    expect(updated.strokes[2]).toBe(added.strokes[2]);
    expect(updateStroke(updated, pen('missing'))).toBe(updated);

    const removed = removeStroke(updated, 'second');
    expect(removed).not.toBe(updated);
    expect(removed.strokes.map(({ id }) => id)).toEqual(['first', 'third']);
    expect(removed.strokes[0]).toBe(first);
    expect(removed.strokes[1]).toBe(updated.strokes[2]);
    expect(removeStroke(removed, 'missing')).toBe(removed);

    const cleared = clearStrokes(removed);
    expect(cleared).not.toBe(removed);
    expect(cleared).toEqual({ schemaVersion: 2, strokes: [] });
    expect(clearStrokes(cleared)).toBe(cleared);
  });

  it('updates and removes only the first matching duplicate ID', () => {
    const firstDuplicate = pen('duplicate', 1);
    const between = pen('between', 2);
    const secondDuplicate = pen('duplicate', 3);
    const initial = documentWith(firstDuplicate, between, secondDuplicate);

    const updated = updateStroke(initial, pen('duplicate', 10));
    expect(updated.strokes.map(({ id }) => id)).toEqual(['duplicate', 'between', 'duplicate']);
    expect(updated.strokes[0].points).toEqual([{ x: 10, y: 0 }]);
    expect(updated.strokes[1]).toBe(between);
    expect(updated.strokes[2]).toBe(secondDuplicate);

    const removed = removeStroke(updated, 'duplicate');
    expect(removed.strokes).toEqual([between, secondDuplicate]);
    expect(removed.strokes[0]).toBe(between);
    expect(removed.strokes[1]).toBe(secondDuplicate);
  });

  it('preserves image resource IDs through read and all document CRUD copies', () => {
    const image: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'image',
      tool: 'image',
      points: [{ x: 1, y: 2 }],
      resourceId: 'resource-1',
      src: 'memory://image',
    };
    const read = readDrawingDocument({ strokes: [image] }).document;
    const added = addStroke(documentWith(pen('first')), image);
    const updated = updateStroke(added, { ...image, points: [{ x: 3, y: 4 }] });

    expect(read.strokes[0]).toMatchObject({ resourceId: 'resource-1', src: 'memory://image' });
    expect(added.strokes[1]).toMatchObject({ resourceId: 'resource-1', src: 'memory://image' });
    expect(updated.strokes[1]).toMatchObject({ resourceId: 'resource-1', src: 'memory://image' });
    expect(removeStroke(updated, 'first').strokes[0]).toMatchObject({ resourceId: 'resource-1' });
  });

  it('keeps retained private math independent from package and platform layers', () => {
    // 完整闭包必须从 canonical core 入口出发，覆盖 index.ts 与全部纯模块。
    const graph = collectCoreImportGraph(['internal.ts']);
    const approvedRoots = [
      resolve(sourceRoot, 'core'),
      resolve(sourceRoot, 'model'),
      resolve(sourceRoot, 'viewport.ts'),
      // GestureSession 只复用尺子纯数学，不能因此放开整个 ruler UI 目录。
      resolve(sourceRoot, 'ruler', 'geometry.ts'),
    ];
    const forbiddenExternal =
      /^(?:react|react-dom|react-native|expo(?:\/|$)|@shopify\/react-native-skia|react-native-gesture-handler|react-native-reanimated|@system-ui-js\/multi-drag)$/;

    expect(graph.sourceFiles).not.toEqual([]);
    graph.sourceFiles.forEach((filePath) => {
      // 以解析后的实际模块位置判断，不按 import 字符串猜测合法的 core/index.ts。
      expect(
        approvedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`))
      ).toBe(true);
      expect(filePath).not.toBe(resolve(sourceRoot, 'index.ts'));
    });
    graph.externalSpecifiers.forEach((specifier) => {
      expect(specifier).not.toMatch(forbiddenExternal);
    });
    graph.sourceFiles.forEach((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      // `document` 是 V2 数据字段而非 DOM；这里仅拒绝平台事件/元素类型与全局 DOM 入口。
      expect(source).not.toMatch(
        /\b(?:PointerEvent|TouchEvent|MouseEvent|HTMLElement|SVGElement|window)\b/
      );
    });

    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'input.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'gesture', 'ownership.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'gesture', 'session.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'viewportTransform.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'preparedDocument.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'spatialIndex.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'drawingFrame.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'selectionTransform.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'editorDocument.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'editorRuntime.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'editorInteraction.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'editorToolSession.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'editorController.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'ruler', 'geometry.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'model', 'strokes.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'viewport.ts'));
  });

  it('keeps the public schema3 core headless with no legacy document or renderer fallback', () => {
    const graph = collectCoreImportGraph(['index.ts'], false);
    const approvedRoots = [
      'core',
      'model',
      'geometry',
      'ruler/geometry.ts',
      'viewport.ts',
      'virtualPaperOptions.ts',
    ].map((entry) => resolve(sourceRoot, entry));
    for (const file of graph.sourceFiles) {
      expect(approvedRoots.some((root) => file === root || file.startsWith(`${root}/`))).toBe(true);
      expect(file).not.toMatch(/\/(?:internal|editorController|strokes|strokeMigration)\.ts$/);
      expect(file).not.toBe(resolve(sourceRoot, 'core/document.ts'));
    }
    expect(graph.externalSpecifiers).toEqual(
      expect.arrayContaining(['perfect-freehand', 'polyclip-ts'])
    );
    expect(
      graph.externalSpecifiers.filter((entry) => /^(?:react|expo|@shopify)/.test(entry))
    ).toEqual([]);
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core/layeredEditorController.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'model/documentReader.ts'));
  });

  it('keeps selection queries within the pure core/model/polygon closure', () => {
    const graph = collectCoreImportGraph(['selectionQuery.ts']);
    const approvedRoots = [resolve(sourceRoot, 'core'), resolve(sourceRoot, 'model')];
    const forbiddenExternal =
      /^(?:react|react-dom|react-native|expo(?:\/|$)|@shopify\/react-native-skia|react-native-gesture-handler|react-native-reanimated|@system-ui-js\/multi-drag)$/;

    expect(graph.sourceFiles).not.toEqual([]);
    graph.sourceFiles.forEach((filePath) => {
      expect(
        approvedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`))
      ).toBe(true);
      expect(filePath).not.toBe(resolve(sourceRoot, 'utils.ts'));
    });
    graph.externalSpecifiers.forEach((specifier) => {
      expect(specifier).not.toMatch(forbiddenExternal);
    });
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'selectionQuery.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'geometry.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'core', 'polygonBoolean.ts'));
    expect(graph.sourceFiles).toContain(resolve(sourceRoot, 'model', 'strokes.ts'));
  });
});
