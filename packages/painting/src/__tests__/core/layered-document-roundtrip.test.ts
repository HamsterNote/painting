/** @jest-environment node */

/**
 * Task 2.2 证据：`model/documentReader.ts`（唯一新增本测试文件）。
 *
 * 契约（冻结 5 exports）：
 * - `DocumentReadError { code: 'invalid-json' | 'invalid-document'; path: string }`
 * - `DocumentReadResult<T> = { ok:true; value:T } | { ok:false; error:DocumentReadError }`
 * - `readLayeredDocument(unknown)` / `parseLayeredDocument(json)` / `serializeLayeredDocument(unknown)`
 *
 * 真实性：使用真实 controller 与真实 PF 派生做 round-trip；reader 为纯内存 typed document 读写，
 * 不含 disk/UI，也不做 V2/migration。
 */

import {
  parseLayeredDocument,
  readLayeredDocument,
  serializeLayeredDocument,
  type DocumentReadError,
  type DocumentReadResult,
} from '../../model/documentReader';
import {
  createLayeredEditorController,
  type LayeredBeginInput,
  type LayeredCommitReceipt,
  type LayeredEditorController,
  type LayeredEditorControllerOptions,
  type LayeredEditorResult,
} from '../../core/layeredEditorController';
import type { FreehandCandidate, FreehandSessionEnd } from '../../core/freehandSession';
import { deriveFreehandGeometry } from '../../geometry/freehand';
import {
  IDENTITY_TRANSFORM,
  type AcceptedSample,
  type BrushSnapshot,
  type DocumentObject,
  type EditorDocument,
  type FreehandObject,
  type ImageObject,
  type ShapeObject,
  type TextObject,
} from '../../model/document';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function unwrap<T>(result: DocumentReadResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}@${result.error.path}`);
  }
  return result.value;
}

function expectError(result: DocumentReadResult<unknown>, code: DocumentReadError['code']): DocumentReadError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected error');
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

function makeSamples(
  phases: readonly ('down' | 'move' | 'up')[] = ['down', 'move', 'up']
): readonly AcceptedSample[] {
  return phases.map((phase, index) => ({
    sequence: index,
    x: index * 4,
    y: index * 3,
    pressure: 0.5,
    time: index * 16,
    phase,
    source: 'pen' as const,
  }));
}

function makeBrush(overrides: Partial<BrushSnapshot> = {}): BrushSnapshot {
  return {
    color: '#123456',
    nominalSize: 8,
    opacity: 1,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  };
}

function makeFreehand(overrides: Partial<FreehandObject> = {}): FreehandObject {
  return {
    kind: 'freehand',
    objectId: 'f1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: 'commit-f1',
    samples: makeSamples(),
    brushSnapshot: makeBrush(),
    resolvedPressureMode: 'real',
    samplesRevision: 1,
    brushRevision: 1,
    ...overrides,
  };
}

function makeShape(overrides: Partial<ShapeObject> = {}): ShapeObject {
  return {
    kind: 'shape',
    objectId: 's1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 2,
    shapeType: 'rect',
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    style: { color: '#000000', width: 2, opacity: 1, dash: [4, 2] },
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    kind: 'image',
    objectId: 'i1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 3,
    src: 'data:image/png;base64,AAAA',
    localBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    ...overrides,
  };
}

function makeText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    kind: 'text',
    objectId: 't1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 4,
    content: 'hello',
    fontSize: 12,
    color: '#000000',
    localBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    ...overrides,
  };
}

function makeDocument(objects: readonly DocumentObject[]): EditorDocument {
  return { schemaVersion: 3, documentRevision: 1, objects };
}

function roundtrip(document: EditorDocument): EditorDocument {
  const json = unwrap(serializeLayeredDocument(document));
  return unwrap(parseLayeredDocument(json));
}

function createController(document: EditorDocument): LayeredEditorController {
  const options: LayeredEditorControllerOptions = {
    document,
    viewport: { revision: 1, viewport: { scale: 2, tx: 10, ty: -5 } },
    activeTool: 'freehand',
    settings: { freehand: makeBrush(), shape: { color: '#000', width: 1, opacity: 1 } },
    allocateObjectId: (commitId: string) => `obj-${commitId}`,
  };
  const result = createLayeredEditorController(options);
  if (!result.ok) {
    throw new Error(`controller create failed: ${result.error.code}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// A. 合法 round-trip
// ---------------------------------------------------------------------------

describe('layeredDocument roundtrip: 合法与 mixed order', () => {
  it('mixed 四类四种顺序 round-trip 保序且内容一致', () => {
    const variants: readonly DocumentObject[][] = [
      [makeFreehand({ objectId: 'a', commitId: 'ca' }), makeShape({ objectId: 'b' }), makeImage({ objectId: 'c' }), makeText({ objectId: 'd' })],
      [makeText({ objectId: 'a' }), makeFreehand({ objectId: 'b', commitId: 'cb' }), makeShape({ objectId: 'c' }), makeImage({ objectId: 'd' })],
      [makeImage({ objectId: 'a' }), makeText({ objectId: 'b' }), makeFreehand({ objectId: 'c', commitId: 'cc' }), makeShape({ objectId: 'd' })],
      [makeShape({ objectId: 'a' }), makeImage({ objectId: 'b' }), makeText({ objectId: 'c' }), makeFreehand({ objectId: 'd', commitId: 'cd' })],
    ];
    for (const objects of variants) {
      const parsed = roundtrip(makeDocument(objects));
      expect(parsed.objects.map((object) => object.kind)).toEqual(objects.map((object) => object.kind));
      expect(parsed.objects.map((object) => object.objectId)).toEqual(objects.map((object) => object.objectId));
      expect(parsed).toEqual(makeDocument(objects));
    }
  });

  it('transformRevision 保留且对象深冻结', () => {
    const parsed = roundtrip(makeDocument([makeFreehand(), makeShape(), makeImage(), makeText()]));
    expect(parsed.objects.map((object) => object.transformRevision)).toEqual([1, 2, 3, 4]);
    expect(parsed.objects.every((object) => Object.isFrozen(object))).toBe(true);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('freehand round-trip 后 final 几何相同（polygon + geometryRevision）', () => {
    const original = makeFreehand();
    const parsed = roundtrip(makeDocument([original]));
    const parsedFreehand = parsed.objects[0] as FreehandObject;
    const before = deriveFreehandGeometry(original, 'final');
    const after = deriveFreehandGeometry(parsedFreehand, 'final');
    expect(after.geometryRevision).toBe(before.geometryRevision);
    expect(after.polygon).toEqual(before.polygon);
  });

  it('单点 tap（down/up 两点，相同 xy）round-trip 保持 raw', () => {
    const tap = makeFreehand({
      samples: [
        { sequence: 0, x: 7, y: 9, pressure: 0.5, time: 0, phase: 'down', source: 'pen' },
        { sequence: 1, x: 7, y: 9, pressure: 0, time: 5, phase: 'up', source: 'pen' },
      ],
    });
    const parsed = roundtrip(makeDocument([tap]));
    const parsedFreehand = parsed.objects[0] as FreehandObject;
    expect(parsedFreehand.samples).toHaveLength(2);
    expect(parsedFreehand.samples.map((s) => s.phase)).toEqual(['down', 'up']);
    expect(parsedFreehand.samples.map((s) => [s.x, s.y])).toEqual([
      [7, 9],
      [7, 9],
    ]);
    expect(parsedFreehand.samples[1].pressure).toBe(0);
  });

  it('readLayeredDocument 接受 typed 文档返回深 copy 冻结', () => {
    const document = makeDocument([makeFreehand()]);
    const read = unwrap(readLayeredDocument(document));
    expect(read).toEqual(document);
    expect(read).not.toBe(document);
    expect(Object.isFrozen(read)).toBe(true);
  });

  it('空文档 round-trip 保持 schema3 与 revision', () => {
    const parsed = roundtrip(makeDocument([]));
    expect(parsed.objects).toHaveLength(0);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.documentRevision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. 白名单剔除 / 冻结 / caller 隔离
// ---------------------------------------------------------------------------

describe('layeredDocument roundtrip: 白名单与冻结', () => {
  it('未知 fields 逐层剔除（document/object/sample/brush/style/bounds 与真实 PF/cache/session 字段）', () => {
    const noisy = {
      schemaVersion: 3,
      documentRevision: 1,
      extraTop: true,
      strokePoints: [[0, 0, 0.5]],
      predicted: [[9, 9]],
      interpolated: [[1, 1]],
      cache: { hit: true },
      session: { owner: 1 },
      objects: [
        {
          ...makeFreehand(),
          extraObject: 1,
          strokePoints: [[0, 0]],
          predicted: [[1, 1]],
          interpolated: [[2, 2]],
          cache: { hit: true },
          sessionId: 's-1',
          pointerId: 1,
          samples: [
            { ...makeSamples()[0], extraSample: 2, strokePoints: [[0, 0]] },
            { ...makeSamples()[1], extraSample: 2, predicted: [[1, 1]] },
            { ...makeSamples()[2], extraSample: 2, interpolated: [[2, 2]] },
          ],
          brushSnapshot: { ...makeBrush(), dash: [1, 1], extraBrush: 3, pressureMultiplier: 2 },
          outline: [[0, 0]],
        },
        {
          ...makeShape(),
          extraObject: 4,
          style: { ...makeShape().style, extraStyle: 1 },
          points: [{ ...makeShape().points[0], extraPoint: 9 }, makeShape().points[1]],
        },
        {
          ...makeImage(),
          extraObject: 6,
          transform: { ...makeImage().transform, extraTransform: 1 },
          localBounds: { ...makeImage().localBounds, extraBounds: 1 },
        },
        { ...makeText(), extraObject: 8 },
      ],
    };

    // serialize → parse（真实 round-trip）也必须全部剔除。
    const parsed = unwrap(readLayeredDocument(noisy));
    const json = unwrap(serializeLayeredDocument(noisy));
    expect(unwrap(parseLayeredDocument(json))).toEqual(parsed);
    for (const forbidden of [
      'extraTop',
      'extraObject',
      'extraSample',
      'extraBrush',
      'extraStyle',
      'extraPoint',
      'extraTransform',
      'extraBounds',
      'outline',
      'strokePoints',
      'predicted',
      'interpolated',
      'cache',
      'session',
      'sessionId',
      'pointerId',
      'pressureMultiplier',
    ]) {
      expect(json).not.toContain(forbidden);
    }
    // 注入到 freehand brush 的非法 dash 被剔除；shape 自身合法 dash 保留。
    expect(Object.prototype.hasOwnProperty.call((parsed.objects[0] as FreehandObject).brushSnapshot, 'dash')).toBe(false);
    expect((parsed.objects[1] as ShapeObject).style.dash).toEqual([4, 2]);
    expect(Object.keys(parsed as unknown as Record<string, unknown>).sort()).toEqual([
      'documentRevision',
      'objects',
      'schemaVersion',
    ]);
    expect((parsed.objects[0] as FreehandObject).brushSnapshot.pressureMode).toBe('real');
  });

  it('深冻结嵌套（sample/brush/transform/points/dash/bounds）', () => {
    const parsed = roundtrip(makeDocument([makeFreehand(), makeShape(), makeImage(), makeText()]));
    const [freehand, shape, image, text] = parsed.objects as [FreehandObject, ShapeObject, ImageObject, TextObject];
    expect(Object.isFrozen(freehand.samples)).toBe(true);
    expect(Object.isFrozen(freehand.samples[0])).toBe(true);
    expect(Object.isFrozen(freehand.brushSnapshot)).toBe(true);
    expect(Object.isFrozen(freehand.transform)).toBe(true);
    expect(Object.isFrozen(shape.points)).toBe(true);
    expect(Object.isFrozen(shape.style.dash)).toBe(true);
    expect(Object.isFrozen(image.localBounds)).toBe(true);
    expect(Object.isFrozen(text.localBounds)).toBe(true);
  });

  it('read 不改 caller；caller 变更不改已读结果', () => {
    const document = makeDocument([makeFreehand()]);
    const before = JSON.stringify(document);
    const read = unwrap(readLayeredDocument(document));
    expect(JSON.stringify(document)).toBe(before);

    const first = read.objects[0] as FreehandObject;
    const originalX = first.samples[0].x;
    const mutable = document.objects[0] as unknown as { samples: { x: number }[] };
    mutable.samples[0].x = 999;
    expect((read.objects[0] as FreehandObject).samples[0].x).toBe(originalX);
  });

  it('serialize 输出无 PF outline/strokePoints/预测/插值/cache/transport 字段', () => {
    const json = unwrap(serializeLayeredDocument(makeDocument([makeFreehand()])));
    for (const forbidden of [
      'polygon',
      'strokePoints',
      'outline',
      'predicted',
      'interpolat',
      'geometryRevision',
      'sessionId',
      'pointerId',
      'viewportRevision',
      'batchSequence',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// C. freehand raw 校验 / 保真
// ---------------------------------------------------------------------------

describe('layeredDocument roundtrip: freehand raw', () => {
  it('缺 pressure 与 pressure=0 存在性精确区分', () => {
    const missing = makeFreehand({
      samples: [
        { sequence: 0, x: 0, y: 0, time: 0, phase: 'down', source: 'pen' },
        { sequence: 1, x: 4, y: 3, time: 16, phase: 'move', source: 'pen' },
        { sequence: 2, x: 8, y: 6, pressure: 0, time: 32, phase: 'up', source: 'pen' },
      ],
    });
    const parsed = roundtrip(makeDocument([missing]));
    const samples = (parsed.objects[0] as FreehandObject).samples;
    expect(Object.prototype.hasOwnProperty.call(samples[0], 'pressure')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(samples[1], 'pressure')).toBe(false);
    expect(samples[2].pressure).toBe(0);
  });

  it('有限越界 pressure 原值保留；time 不排序、重复坐标不去重', () => {
    const raw = makeFreehand({
      samples: [
        { sequence: 0, x: 5, y: 5, pressure: 1.5, time: 100, phase: 'down', source: 'pen' },
        { sequence: 1, x: 5, y: 5, pressure: -0.5, time: 100, phase: 'move', source: 'pen' },
        { sequence: 2, x: 5, y: 5, pressure: 0.5, time: 20, phase: 'up', source: 'pen' },
      ],
    });
    const samples = (roundtrip(makeDocument([raw])).objects[0] as FreehandObject).samples;
    expect(samples.map((s) => s.pressure)).toEqual([1.5, -0.5, 0.5]);
    expect(samples.map((s) => s.time)).toEqual([100, 100, 20]);
    expect(samples.every((s) => s.x === 5 && s.y === 5)).toBe(true);
  });

  it('极端合法 raw 值原值保留', () => {
    const raw = makeFreehand({
      samples: [
        { sequence: 0, x: -1e12, y: 1e12, pressure: 2, time: 0, phase: 'down', source: 'pen' },
        { sequence: 1, x: 1e12, y: -1e12, pressure: 0, time: Number.MAX_SAFE_INTEGER, phase: 'up', source: 'pen' },
      ],
    });
    const samples = (roundtrip(makeDocument([raw])).objects[0] as FreehandObject).samples;
    expect(samples[0].x).toBe(-1e12);
    expect(samples[1].time).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('mode 与 pressureMode 一致性：auto 不重新判（resolved 原样）', () => {
    const autoReal = makeFreehand({ brushSnapshot: makeBrush({ pressureMode: 'auto' }), resolvedPressureMode: 'real' });
    const parsed = roundtrip(makeDocument([autoReal]));
    const freehand = parsed.objects[0] as FreehandObject;
    expect(freehand.brushSnapshot.pressureMode).toBe('auto');
    expect(freehand.resolvedPressureMode).toBe('real');
    expect(roundtrip(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ pressureMode: 'constant' }), resolvedPressureMode: 'constant' })]))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// D. shape / image / text 校验
// ---------------------------------------------------------------------------

describe('layeredDocument roundtrip: shape/image/text', () => {
  it('shape：dash 非负有限、fill 可选、points 数量不额外约束', () => {
    const shape = makeShape({
      points: [{ x: 0, y: 0 }],
      style: { color: '#000', width: 1, opacity: 0.5, dash: [0, 2.5], fill: '#fff' },
    });
    const parsed = roundtrip(makeDocument([shape]));
    const out = parsed.objects[0] as ShapeObject;
    expect(out.points).toHaveLength(1);
    expect(out.style.dash).toEqual([0, 2.5]);
    expect(out.style.fill).toBe('#fff');
  });

  it('image：src 非空、resourceId 可选非空', () => {
    const image = makeImage({ resourceId: 'res-1' });
    const parsed = roundtrip(makeDocument([image]));
    expect((parsed.objects[0] as ImageObject).src).toBe('data:image/png;base64,AAAA');
    expect((parsed.objects[0] as ImageObject).resourceId).toBe('res-1');
  });

  it('text：允许空 content、fontSize>0、color 非空', () => {
    const text = makeText({ content: '' });
    const parsed = roundtrip(makeDocument([text]));
    expect((parsed.objects[0] as TextObject).content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// E. 非法输入（分组 table）
// ---------------------------------------------------------------------------

describe('layeredDocument roundtrip: 非法输入', () => {
  function gapDocument(): EditorDocument {
    return makeDocument([
      makeFreehand({
        samples: [{ ...makeSamples()[0], sequence: 5 }, makeSamples()[1], makeSamples()[2]],
      }),
    ]);
  }

  function mixedSourceDocument(): EditorDocument {
    return makeDocument([
      makeFreehand({
        samples: [
          { ...makeSamples()[0], source: 'pen' as const },
          { ...makeSamples()[1], source: 'touch' as const },
          makeSamples()[2],
        ],
      }),
    ]);
  }

  function firstSampleDoc(overrides: Partial<AcceptedSample>): DocumentReadResult<unknown> {
    return readLayeredDocument(
      makeDocument([
        makeFreehand({
          samples: [{ ...makeSamples()[0], ...overrides }, makeSamples()[1], makeSamples()[2]],
        }),
      ])
    );
  }

  const invalidJsonCases: ReadonlyArray<readonly [string, () => DocumentReadResult<unknown>]> = [
    ['不可解析 JSON', () => parseLayeredDocument('{ not json')],
    ['非字符串 runtime', () => parseLayeredDocument(123 as unknown as string)],
  ];

  it('parse：非法 JSON / 非字符串 → invalid-json', () => {
    for (const [name, run] of invalidJsonCases) {
      const error = expectError(run(), 'invalid-json');
      expect(typeof error.path).toBe('string');
      expect(name).toBeTruthy();
    }
  });

  const invalidDocumentCases: ReadonlyArray<readonly [string, () => DocumentReadResult<unknown>]> = [
    ['null', () => readLayeredDocument(null)],
    ['JSON null 文档', () => parseLayeredDocument('null')],
    ['非对象', () => readLayeredDocument(42)],
    ['旧 schema2', () => readLayeredDocument({ ...makeDocument([makeFreehand()]), schemaVersion: 2 })],
    ['未知 kind', () => readLayeredDocument(makeDocument([{ kind: 'unknown', objectId: 'x' } as unknown as DocumentObject]))],
    ['缺 samples', () => readLayeredDocument(makeDocument([{ ...makeFreehand(), samples: undefined } as unknown as DocumentObject]))],
    ['documentRevision 负数', () => readLayeredDocument({ ...makeDocument([]), documentRevision: -1 })],
    ['documentRevision 非整数', () => readLayeredDocument({ ...makeDocument([]), documentRevision: 1.5 })],
    ['objectId 重复', () => readLayeredDocument(makeDocument([makeFreehand({ objectId: 'dup', commitId: 'c1' }), makeShape({ objectId: 'dup' })]))],
    ['commitId 重复', () => readLayeredDocument(makeDocument([makeFreehand({ objectId: 'a', commitId: 'same' }), makeFreehand({ objectId: 'b', commitId: 'same' })]))],
    ['phase 首帧非 down', () => readLayeredDocument(makeDocument([makeFreehand({ samples: makeSamples(['move', 'up']) })]))],
    ['sequence gap', () => readLayeredDocument(gapDocument())],
    ['mixed source', () => readLayeredDocument(mixedSourceDocument())],
    ['brush size<=0', () => readLayeredDocument(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ nominalSize: 0 }) })]))],
    ['brush opacity 越界', () => readLayeredDocument(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ opacity: 2 }) })]))],
    ['brush presetRevision 非法', () => readLayeredDocument(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ presetRevision: -1 }) })]))],
    ['transform NaN', () => readLayeredDocument(makeDocument([makeFreehand({ transform: { ...IDENTITY_TRANSFORM, a: Number.NaN } })]))],
    ['transform 奇异', () => readLayeredDocument(makeDocument([makeFreehand({ transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 } })]))],
    ['bounds 顺序反转', () => readLayeredDocument(makeDocument([makeImage({ localBounds: { minX: 10, minY: 0, maxX: 0, maxY: 10 } })]))],
    ['image src 空', () => readLayeredDocument(makeDocument([makeImage({ src: '' })]))],
    ['text fontSize<=0', () => readLayeredDocument(makeDocument([makeText({ fontSize: 0 })]))],
    ['shape dash 负数', () => readLayeredDocument(makeDocument([makeShape({ style: { color: '#000', width: 1, opacity: 1, dash: [-1] } })]))],
    ['shape dash 非有限', () => readLayeredDocument(makeDocument([makeShape({ style: { color: '#000', width: 1, opacity: 1, dash: [Number.POSITIVE_INFINITY] } })]))],
    ['raw pressure NaN', () => firstSampleDoc({ pressure: Number.NaN })],
    ['raw pressure Infinity', () => firstSampleDoc({ pressure: Number.POSITIVE_INFINITY })],
    ['raw x Infinity', () => firstSampleDoc({ x: Number.POSITIVE_INFINITY })],
    ['raw time NaN', () => firstSampleDoc({ time: Number.NaN })],
    ['objectRevision unsafe+1', () => readLayeredDocument(makeDocument([makeFreehand({ objectRevision: Number.MAX_SAFE_INTEGER + 1 })]))],
    ['samplesRevision unsafe', () => readLayeredDocument(makeDocument([makeFreehand({ samplesRevision: -1 })]))],
    ['transformRevision unsafe', () => readLayeredDocument(makeDocument([makeShape({ transformRevision: Number.MAX_SAFE_INTEGER + 1 })]))],
    ['middle phase 非 move', () => readLayeredDocument(makeDocument([makeFreehand({ samples: makeSamples(['down', 'down', 'up']) })]))],
    ['end phase 非 up', () => readLayeredDocument(makeDocument([makeFreehand({ samples: makeSamples(['down', 'move', 'move']) })]))],
    ['显式 constant 与 resolved real 不一致', () => readLayeredDocument(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ pressureMode: 'constant' }), resolvedPressureMode: 'real' })]))],
    ['resolvedPressureMode 未知', () => readLayeredDocument(makeDocument([makeFreehand({ resolvedPressureMode: 'weird' as never })]))],
    ['brush pressureMode 未知', () => readLayeredDocument(makeDocument([makeFreehand({ brushSnapshot: makeBrush({ pressureMode: 'weird' as never }) })]))],
    ['sample source 未知', () => firstSampleDoc({ source: 'weird' as never })],
    ['image resourceId 空', () => readLayeredDocument(makeDocument([makeImage({ resourceId: '' })]))],
    ['bounds 非有限', () => readLayeredDocument(makeDocument([makeImage({ localBounds: { minX: 0, minY: 0, maxX: Number.POSITIVE_INFINITY, maxY: 10 } })]))],
  ];

  it('read 非法输入 → invalid-document（分组）', () => {
    for (const [name, run] of invalidDocumentCases) {
      const error = expectError(run(), 'invalid-document');
      expect(typeof error.path).toBe('string');
      expect(name).toBeTruthy();
    }
  });

  it('自由笔单条样本 → invalid-document', () => {
    expectError(
      readLayeredDocument(makeDocument([makeFreehand({ samples: makeSamples(['down']) })])),
      'invalid-document'
    );
  });

  it('error.path 精确指向已知字段', () => {
    const result = readLayeredDocument(
      makeDocument([
        makeFreehand({
          samples: [makeSamples()[0], { ...makeSamples()[1], pressure: Number.NaN }, makeSamples()[2]],
        }),
      ])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-document');
      expect(result.error.path).toBe('$.objects[0].samples[1].pressure');
    }
  });

  it('serialize 非文档输入 → error', () => {
    const result = serializeLayeredDocument(null);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. 真实 controller → serialize → parse → new controller
// ---------------------------------------------------------------------------

/** unwrap 真实 controller Result；失败直接 throw 便于定位。 */
function unwrapEditor<T>(result: LayeredEditorResult<T>): T {
  if (!result.ok) {
    throw new Error(`controller op failed: ${result.error.code}`);
  }
  return result.value;
}

function beginInput(commitId: string): LayeredBeginInput {
  return {
    type: 'begin',
    commitId,
    pressureCapability: 'available',
    batch: {
      sessionId: `s-${commitId}`,
      pointerId: 1,
      source: 'pen',
      batchSequence: 0,
      coordinateSpace: 'world',
      viewportRevision: 1,
      samples: [
        { sequence: 0, x: 0, y: 0, pressure: 0.5, time: 0, phase: 'down' },
        { sequence: 1, x: 4, y: 3, pressure: 0.6, time: 16, phase: 'move' },
      ],
    },
  };
}

function commitStroke(controller: LayeredEditorController, commitId: string): LayeredCommitReceipt {
  const begin = beginInput(commitId);
  unwrapEditor(controller.beginFreehand(begin));
  const end: FreehandSessionEnd = {
    type: 'end',
    batch: {
      ...begin.batch,
      batchSequence: 1,
      samples: [{ sequence: 2, x: 8, y: 6, pressure: 0, time: 32, phase: 'up' }],
    },
  };
  unwrapEditor<FreehandCandidate>(controller.endFreehand(end));
  return unwrapEditor(controller.commitFreehand(commitId));
}

describe('layeredDocument roundtrip: controller 集成', () => {
  it('commit → serialize/parse → 新 controller 同 commitId duplicate，registry 恢复', () => {
    const controller = createController(makeDocument([]));
    const committed = commitStroke(controller, 'c1');
    expect(committed.status).toBe('created');

    const json = unwrap(serializeLayeredDocument(controller.getSnapshot('document')));
    const parsed = unwrap(parseLayeredDocument(json));
    const revived = createController(parsed);

    const duplicate = unwrapEditor(revived.commitFreehand('c1'));
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.objectId).toBe(committed.objectId);
    expect(duplicate.documentRevision).toBe(committed.documentRevision);
    expect(duplicate.presentInDocument).toBe(true);
  });

  it('parse 后的文档可继续 commit + 真实 undo', () => {
    const controller = createController(makeDocument([]));
    commitStroke(controller, 'c1');
    const parsed = unwrap(parseLayeredDocument(unwrap(serializeLayeredDocument(controller.getSnapshot('document')))));
    const revived = createController(parsed);

    expect(commitStroke(revived, 'c2').status).toBe('created');

    const undo = unwrapEditor(revived.undo());
    expect(undo.objects.filter((object) => object.kind === 'freehand')).toHaveLength(1);
  });

  it('serialize→parse→serialize 稳定（幂等）', () => {
    const controller = createController(makeDocument([makeFreehand()]));
    const json1 = unwrap(serializeLayeredDocument(controller.getSnapshot('document')));
    const parsed = unwrap(parseLayeredDocument(json1));
    const json2 = unwrap(serializeLayeredDocument(parsed));
    expect(json2).toBe(json1);
  });

  it('round-trip 后对象顺序与 commitId 序列保持', () => {
    const controller = createController(makeDocument([]));
    commitStroke(controller, 'c1');
    commitStroke(controller, 'c2');
    const parsed = roundtrip(controller.getSnapshot('document'));
    const commitIds = parsed.objects
      .filter((object): object is FreehandObject => object.kind === 'freehand')
      .map((object) => object.commitId);
    expect(commitIds).toEqual(['c1', 'c2']);
  });
});


