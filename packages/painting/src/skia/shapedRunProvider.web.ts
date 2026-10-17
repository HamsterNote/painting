import type {
  FrameShapedGlyphRun,
  FrameTextProgram,
  FrameTextRequest,
  FrameTextSemanticRegion,
} from '../core/frameClipping';

/**
 * CanvasKit 0.41 的公开 Paragraph wrapper 没有导出 shaped-run 类型。这里刻意使用最小结构
 * 探测，避免引入 CanvasKit package 或把它带进 native bundle。所有 Web JSI 对象仅在调用方
 * 已确认 Skia ready 后传入。
 */
type CanvasKitShapedRun = Readonly<{
  glyphs?: ArrayLike<number>;
  glyphIDs?: ArrayLike<number>;
  positions?: ArrayLike<number>;
  offsets?: ArrayLike<number>;
  clusters?: ArrayLike<number>;
  typeface?: unknown;
  size?: number;
  scaleX?: number;
}>;

type CanvasKitShapedLine = Readonly<{
  runs?: readonly CanvasKitShapedRun[];
}>;

type CanvasKitParagraph = Readonly<{
  getShapedLines?: () => readonly CanvasKitShapedLine[];
  getLineMetrics?: () => readonly Readonly<{ width?: number; left?: number }> [];
}>;

/** 接受 RN Skia wrapper 或其 .ref；不会把 CanvasKit 类型泄漏到本模块边界。 */
export type WebShapingParagraphFactory = (request: FrameTextRequest) => unknown;
/** 真实 Web Skia 上的 font 构造门；返回值仅由 renderer 不透明消费。 */
export type WebShapedRunFontPreflight = (
  typeface: FrameShapedGlyphRun['typeface'],
  size: number,
  scaleX: number
) => unknown | null;

export type WebShapingResult =
  | Readonly<{ state: 'ready'; program: FrameTextProgram }>
  | Readonly<{ state: 'pending'; cursor: number }>
  | Readonly<{ state: 'unsupported'; reason: 'missing-capability' | 'unsafe-layout' | 'invalid-shaped-lines' }>;

export type WebShapingContinuation = Readonly<{ revision: string; cursor: number; budget: number }>;

type CacheEntry = Readonly<{
  revision: string;
  request: FrameTextRequest;
  runs: readonly FrameShapedGlyphRun[];
  cursor: number;
}>;

function finite(value: number): boolean { return Number.isFinite(value); }
function point(x: number, y: number) { return Object.freeze({ x, y }); }
// 单个 provider 绑定一个已就绪 single-font resource；font identity 属于 instance，其他 shaping
// 输入仍全部并入 key，防止调用方复用 revision 时意外复用不同文本/宽度的缓存。
function cacheKey(request: FrameTextRequest): string {
  return `${request.revision}\u0000${request.text}\u0000${request.fontSize}\u0000${request.paragraphWidth}\u0000${request.paragraphLayoutWidth}\u0000${request.paragraphDirection}\u0000${request.paragraphAlignment}`;
}

function copyNumbers(values: ArrayLike<number> | undefined, Type: Uint16ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor): Uint16Array | Uint32Array | Float32Array | null {
  if (!values) return null;
  const copied = new Type(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!finite(value)) return null;
    copied[index] = value;
  }
  return copied;
}

/** CanvasKit 字形 offset 是 UTF-8 字节序；不将其当 JS UTF-16 下标，更不会据此 substring。 */
function normalizeByteOffsets(offsets: ArrayLike<number> | undefined, glyphCount: number): Uint32Array | undefined | null {
  if (!offsets) return undefined;
  if (offsets.length !== glyphCount + 1 || !Array.from(offsets).every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff)) return null;
  const copied = copyNumbers(offsets, Uint32Array) as Uint32Array | null;
  return copied && copied.every((value) => Number.isInteger(value) && value >= 0) ? copied : null;
}

type RawCanvasKitTypeface = Readonly<{ getGlyphIDs: (text: string, numCodePoints?: number) => ArrayLike<number> }>;

function isRawCanvasKitTypeface(value: unknown): value is RawCanvasKitTypeface {
  return !!value && typeof value === 'object' &&
    'getGlyphIDs' in value && typeof (value as Readonly<{ getGlyphIDs?: unknown }>).getGlyphIDs === 'function';
}

/** HostObject.fromValue 只读取 .ref；此 Web-only wrapper 让 raw CanvasKit Typeface 能进入 Skia.Font。 */
function asSkiaTypeface(raw: unknown): FrameShapedGlyphRun['typeface'] | null {
  if (!isRawCanvasKitTypeface(raw)) return null;
  return Object.freeze({
    __typename__: 'Typeface' as const,
    ref: raw,
    // raw typeface 的生命周期属于 CanvasKit Paragraph；wrapper 本身绝不 dispose 它。
    dispose() {},
    getGlyphIDs(text: string, numCodePoints?: number) { return Array.from(raw.getGlyphIDs(text, numCodePoints)); },
  });
}

function copyRun(source: CanvasKitShapedRun, preflightFont: WebShapedRunFontPreflight): FrameShapedGlyphRun | null {
  const sourceGlyphs = source.glyphs ?? source.glyphIDs;
  const glyphs = copyNumbers(sourceGlyphs, Uint16Array) as Uint16Array | null;
  const positionsWithTail = copyNumbers(source.positions, Float32Array) as Float32Array | null;
  const typeface = asSkiaTypeface(source.typeface);
  const size = source.size;
  const scaleX = source.scaleX ?? 1;
  if (!glyphs || !positionsWithTail || !typeface || glyphs.length === 0 ||
    positionsWithTail.length !== (glyphs.length + 1) * 2 ||
    !sourceGlyphs || !Array.from(sourceGlyphs).every((glyph) => Number.isInteger(glyph) && glyph >= 0 && glyph <= 0xffff) ||
    !finite(size ?? Number.NaN) || size === undefined || size <= 0 || !finite(scaleX) || scaleX <= 0) return null;
  const offsets = normalizeByteOffsets(source.offsets, glyphs.length);
  const clusters = normalizeByteOffsets(source.clusters, glyphs.length);
  if (offsets === null || clusters === null) return null;
  // Skia.Font 的构造属于 Web 平台层。它必须在 core 接纳 render/hit program 前成功，不能留给
  // renderer 首次 catch；opaque handle 随 run 一起传递，core 不会读取它。
  const font = preflightFont(typeface, size, scaleX);
  if (!font) return null;
  // CanvasKit positions 的最后一对是 run advance 尾槽，Glyphs 只能消费每个 glyph 的前 2N 项。
  const positions = positionsWithTail.slice(0, glyphs.length * 2);
  return Object.freeze({ glyphs, positions, typeface, font, fontReady: true, size, scaleX,
    ...(offsets === undefined ? {} : { offsets }),
    ...(clusters === undefined ? {} : { clusters }),
  });
}

function copyShapedLines(paragraph: CanvasKitParagraph, preflightFont: WebShapedRunFontPreflight): readonly FrameShapedGlyphRun[] | null {
  const source = paragraph.getShapedLines?.();
  if (!source || source.length === 0) return null;
  const copied: FrameShapedGlyphRun[] = [];
  for (const line of source) {
    if (!line.runs) return null;
    for (const run of line.runs) {
      const copiedRun = copyRun(run, preflightFont);
      if (copiedRun === null) return null;
      copied.push(copiedRun);
    }
  }
  return copied.length > 0 ? Object.freeze(copied) : null;
}

function visibleRuns(runs: readonly FrameShapedGlyphRun[], cursor: number, budget: number): readonly FrameShapedGlyphRun[] {
  const end = Math.min(runs.length, cursor + Math.max(1, Math.floor(budget)));
  return Object.freeze(runs.slice(cursor, end));
}

function transformedPoint(request: FrameTextRequest, x: number, y: number) {
  const cosine = Math.cos(request.rotationRad);
  const sine = Math.sin(request.rotationRad);
  return point(request.paragraphOrigin.x + x * cosine - y * sine, request.paragraphOrigin.y + x * sine + y * cosine);
}

function polygonArea(polygon: readonly Readonly<{ x: number; y: number }>[]): number {
  return polygon.reduce((area, current, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + current.x * next.y - next.x * current.y;
  }, 0) / 2;
}

function isConvexPolygon(polygon: readonly Readonly<{ x: number; y: number }>[]): boolean {
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index];
    const second = polygon[(index + 1) % polygon.length];
    const third = polygon[(index + 2) % polygon.length];
    const cross = (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
    if (!finite(cross)) return false;
    if (cross !== 0) {
      const nextDirection = cross > 0 ? 1 : -1;
      if (direction !== 0 && direction !== nextDirection) return false;
      direction = nextDirection;
    }
  }
  return direction !== 0;
}

/** Frame text 可见区域来自矩形裁剪，因此是凸 polygon；不满足该输入契约时明确拒绝。 */
function clipConvexPolygon(
  subject: readonly Readonly<{ x: number; y: number }>[],
  clip: readonly Readonly<{ x: number; y: number }>[],
): readonly Readonly<{ x: number; y: number }>[] | null {
  if (clip.length < 3 || !isConvexPolygon(clip) || ![...subject, ...clip].every((value) => finite(value.x) && finite(value.y))) return null;
  const signedArea = polygonArea(clip);
  if (!finite(signedArea) || signedArea === 0) return null;
  const direction = signedArea > 0 ? 1 : -1;
  let output = [...subject];
  for (let index = 0; index < clip.length; index += 1) {
    const start = clip[index];
    const end = clip[(index + 1) % clip.length];
    const cross = (value: Readonly<{ x: number; y: number }>) =>
      direction * ((end.x - start.x) * (value.y - start.y) - (end.y - start.y) * (value.x - start.x));
    const at = (from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>) => {
      const fromCross = cross(from);
      const toCross = cross(to);
      const ratio = fromCross / (fromCross - toCross);
      return point(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
    };
    const input = output;
    output = [];
    for (let candidateIndex = 0; candidateIndex < input.length; candidateIndex += 1) {
      const previous = input[(candidateIndex + input.length - 1) % input.length];
      const current = input[candidateIndex];
      const previousInside = cross(previous) >= 0;
      const currentInside = cross(current) >= 0;
      if (previousInside !== currentInside) output.push(at(previous, current));
      if (currentInside) output.push(current);
    }
  }
  return output.length >= 3 && output.every((value) => finite(value.x) && finite(value.y))
    ? Object.freeze(output.map((value) => point(value.x, value.y)))
    : Object.freeze([]);
}

function glyphRegions(run: FrameShapedGlyphRun, request: FrameTextRequest): readonly FrameTextSemanticRegion[] | null {
  const regions: FrameTextSemanticRegion[] = [];
  for (let glyphIndex = 0; glyphIndex < run.glyphs.length; glyphIndex += 1) {
    const x = run.positions[glyphIndex * 2];
    const y = run.positions[glyphIndex * 2 + 1];
    const nextX = glyphIndex + 1 < run.glyphs.length ? run.positions[(glyphIndex + 1) * 2] : undefined;
    const halfWidth = run.size * run.scaleX;
    // 相邻 origin 只能给出 advance 的近似；两侧加一个 em 保守覆盖 RTL、零 advance 的组合
    // glyph 和未知 outline，不能因没有逐 glyph bounds 而漏渲/漏命中真实 run。
    const left = (nextX === undefined ? x : Math.min(x, nextX)) - halfWidth;
    const right = (nextX === undefined ? x : Math.max(x, nextX)) + halfWidth;
    const localBox = [
      point(left, y - run.size), point(right, y - run.size), point(right, y + run.size), point(left, y + run.size),
    ];
    const clipped = clipConvexPolygon(localBox.map((value) => transformedPoint(request, value.x, value.y)), request.visiblePolygon);
    if (clipped === null) return null;
    if (clipped.length >= 3) regions.push(Object.freeze({ polygon: clipped }));
  }
  return Object.freeze(regions);
}

/** 只保留与可见 polygon 真正相交的已解析 run，绝不按 substring/cluster 重排。 */
function selectVisibleRuns(runs: readonly FrameShapedGlyphRun[], request: FrameTextRequest): Readonly<{ runs: readonly FrameShapedGlyphRun[]; regions: readonly FrameTextSemanticRegion[] }> | null {
  const selected: FrameShapedGlyphRun[] = [];
  const regions: FrameTextSemanticRegion[] = [];
  for (const run of runs) {
    const runRegions = glyphRegions(run, request);
    if (runRegions === null) return null;
    if (runRegions.length > 0) {
      selected.push(run);
      regions.push(...runRegions);
    }
  }
  return Object.freeze({ runs: Object.freeze(selected), regions: Object.freeze(regions) });
}

/** 选择 paragraph-local anchor q，使 frame anchor A=O+R*q 落在可见区域中心。 */
function rebaseAtVisibleArea(request: FrameTextRequest) {
  const center = request.visiblePolygon.reduce(
    (sum, value) => ({ x: sum.x + value.x / request.visiblePolygon.length, y: sum.y + value.y / request.visiblePolygon.length }),
    { x: 0, y: 0 }
  );
  const cosine = Math.cos(request.rotationRad);
  const sine = Math.sin(request.rotationRad);
  const dx = center.x - request.paragraphOrigin.x;
  const dy = center.y - request.paragraphOrigin.y;
  return {
    anchor: point(center.x, center.y),
    offset: point(dx * cosine + dy * sine, -dx * sine + dy * cosine),
  };
}

/** 只平移真实 shaping 结果；不读取 text、更不按 cluster 重新截段/布局。 */
function rebaseRuns(lines: readonly FrameShapedGlyphRun[], offset: Readonly<{ x: number; y: number }>): readonly FrameShapedGlyphRun[] | null {
  const rebased: FrameShapedGlyphRun[] = [];
  for (const line of lines) {
    const positions = new Float32Array(line.positions.length);
    for (let index = 0; index < positions.length; index += 2) {
      const x = line.positions[index] - offset.x;
      const y = line.positions[index + 1] - offset.y;
      if (!finite(x) || !finite(y)) return null;
      positions[index] = x;
      positions[index + 1] = y;
    }
    rebased.push(Object.freeze({ glyphs: line.glyphs, positions, typeface: line.typeface, font: line.font, fontReady: line.fontReady, size: line.size, scaleX: line.scaleX,
      ...(line.offsets ? { offsets: line.offsets } : {}),
      ...(line.clusters ? { clusters: line.clusters } : {}),
    }));
  }
  return Object.freeze(rebased);
}

function programFor(request: FrameTextRequest, lines: readonly FrameShapedGlyphRun[]): FrameTextProgram | null {
  const rebasing = rebaseAtVisibleArea(request);
  const visible = selectVisibleRuns(lines, request);
  if (visible === null) return null;
  // 没有实际 glyph 与 frame 相交时，空 program 同时让 renderer 与 hit 安静退出。
  if (visible.runs.length === 0 || visible.regions.length === 0) return Object.freeze({ kind: 'empty-text' });
  const runs = rebaseRuns(visible.runs, rebasing.offset);
  return runs === null ? null : Object.freeze({
    kind: 'shaped-runs', anchor: rebasing.anchor, rotationRad: request.rotationRad, runs, semanticRegions: visible.regions,
  });
}

/**
 * paragraph-slice 仅在单行、left/start 且原宽不会 soft-wrap 时允许。当前 provider 默认输出
 * shaped-runs；这个守卫仍为后续缓存完整 Paragraph 的零拷贝优化提供明确的安全门。
 */
export function canUseParagraphWindow(request: FrameTextRequest, paragraph: CanvasKitParagraph): boolean {
  const metrics = paragraph.getLineMetrics?.();
  const hardLineCount = request.text.split(/\r\n|[\n\r]/).length;
  return !!metrics && metrics.length === hardLineCount && metrics.every((metric) =>
    finite(metric.width ?? Number.NaN) && (metric.width ?? Infinity) <= request.paragraphLayoutWidth &&
    (metric.left ?? Number.NaN) === 0
  );
}

/** revision 缓存只保留纯字形数组；驱逐时可安全丢弃 JS 侧引用并在空闲阶段重新 prepare。 */
export class WebShapedRunProvider {
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(
    private readonly makeParagraph: WebShapingParagraphFactory,
    private readonly preflightFont: WebShapedRunFontPreflight,
    private readonly capacity = 8,
    private readonly maxLayoutWidth = 1_000_000
  ) {}

  public prepare(request: FrameTextRequest, continuation: WebShapingContinuation = { revision: cacheKey(request), cursor: 0, budget: Number.MAX_SAFE_INTEGER }): WebShapingResult {
    if (request.text.length === 0) return Object.freeze({ state: 'ready', program: Object.freeze({ kind: 'empty-text' }) });
    const key = cacheKey(request);
    if (continuation.revision !== key || !Number.isInteger(continuation.cursor) || continuation.cursor < 0 || !finite(continuation.budget) || continuation.budget < 0) return Object.freeze({ state: 'unsupported', reason: 'unsafe-layout' });
    if (!finite(request.paragraphWidth) || request.paragraphWidth <= 0 || !finite(request.paragraphLayoutWidth) || request.paragraphLayoutWidth <= 0 || request.paragraphLayoutWidth > request.paragraphWidth || request.paragraphLayoutWidth > this.maxLayoutWidth) {
      return Object.freeze({ state: 'unsupported', reason: 'unsafe-layout' });
    }
    let entry = this.cache.get(key);
    if (!entry) {
      const wrapped = this.makeParagraph(request);
      const paragraph = (wrapped && typeof wrapped === 'object' && 'ref' in wrapped
        ? (wrapped as Readonly<{ ref?: unknown }>).ref
        : wrapped) as CanvasKitParagraph | null;
      if (!paragraph?.getShapedLines) return Object.freeze({ state: 'unsupported', reason: 'missing-capability' });
      // 原始宽度超出预算时，有限 layout 只能在严格证明没有新增 soft wrap、并保持 hard-break
      // 结构和 start-left 行定位时使用；否则保持显式 unsupported，绝不把原始宽传给 CanvasKit。
      if (request.paragraphWidth > request.paragraphLayoutWidth && (
        request.paragraphDirection !== 'ltr' || request.paragraphAlignment !== 'start' ||
        !canUseParagraphWindow(request, paragraph)
      )) {
        return Object.freeze({ state: 'unsupported', reason: 'unsafe-layout' });
      }
      const runs = copyShapedLines(paragraph, this.preflightFont);
      if (!runs) return Object.freeze({ state: 'unsupported', reason: 'invalid-shaped-lines' });
      // prepare 完整读取并冻结 CanvasKit 数据；cursor 仅分块消费已缓存的 run，未承诺增量 shaping。
      entry = Object.freeze({ revision: key, request, runs, cursor: 0 });
      this.cache.set(key, entry);
      while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
    }
    const runs = visibleRuns(entry.runs, continuation.cursor, continuation.budget);
    const next = continuation.cursor + runs.length;
    if (next < entry.runs.length) return Object.freeze({ state: 'pending', cursor: next });
    if (entry.runs.length === 0) return Object.freeze({ state: 'unsupported', reason: 'invalid-shaped-lines' });
    // continuation 只限制一次 prepare 的工作额度；完成后 program 仍包含同一真实 Paragraph 的全量 runs。
    const program = programFor(request, entry.runs);
    return program === null ? Object.freeze({ state: 'unsupported', reason: 'unsafe-layout' }) : Object.freeze({ state: 'ready', program });
  }

  public continuation(request: FrameTextRequest, cursor: number, budget: number): WebShapingContinuation {
    return Object.freeze({ revision: cacheKey(request), cursor, budget });
  }

  public getCached(request: FrameTextRequest): FrameTextProgram | null {
    const entry = this.cache.get(cacheKey(request));
    if (!entry || entry.request.revision !== request.revision) return null;
    return programFor(request, entry.runs);
  }
}
