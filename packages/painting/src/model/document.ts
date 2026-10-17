/**
 * 分层自由笔文档模型（schemaVersion 3）契约类型。
 *
 * 本文件只冻结“类型 + 纯压力解析函数 + 不可变 identity 常量”，不包含构造函数、
 * 序列化/反序列化或冻结器——这些留待下一步专门的 reader/constructor 落点。
 *
 * 设计约束（与 change design.md / specs 一致）：
 * - 文档是有稳定 objectId 的有序对象数组，freehand/shape/image/text 共用对象变换与顺序。
 * - 持久化只保存真实接受的原始样本与落笔 brush snapshot；不保存预测点、私有插值或
 *   PF 轮廓等派生缓存，也不包含任何 Skia descriptor / legacy 字段。
 * - 所有对象使用局部几何 + 对象 transform，绝不把变换烘焙进 samples。
 * - 不依赖 V2 model/strokeMigration、controller、DOM 或 Skia。
 */

/** 新文档 schema 版本；V2（及更早）不在此契约内，也不提供 fallback。 */
export const LAYERED_SCHEMA_VERSION = 3 as const;

/** 平台无关的二维 DIP 点（局部或世界坐标，由调用方语义决定）。 */
export type Point = Readonly<{
  x: number;
  y: number;
}>;

/** 轴对齐包围盒，约定 minX <= maxX 且 minY <= maxY。 */
export type Bounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

/**
 * 统一 2D 仿射变换，采用屏幕空间约定：
 *   x' = a * x + c * y + tx
 *   y' = b * x + d * y + ty
 * 所有对象 transform 与文档坐标换算共用该结构；要求各分量有限且矩阵非奇异。
 */
export type AffineTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}>;

/** 不可变单位仿射。调用方不得就地修改，需要变换时使用纯函数返回新对象。 */
export const IDENTITY_TRANSFORM: AffineTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

/** 接受样本的指针阶段；不含预测/合成阶段。 */
export type SamplePhase = 'down' | 'move' | 'up';

/** 输入来源；native 表示未来原生 adapter 的语义批量提交，不代表本期已实现原生墨迹。 */
export type InputSource = 'mouse' | 'touch' | 'pen' | 'native';

/** 用户/工具请求的压力模式；auto 在落笔时解析为具体模式。 */
export type PressureMode = 'auto' | 'real' | 'simulated' | 'constant';

/** 落笔后锁定的实际压力模式；整笔不再切换。 */
export type ResolvedPressureMode = 'real' | 'simulated' | 'constant';

/** adapter 声明的压力能力；不得由 pressure > 0 或变化率推断。 */
export type PressureCapability = 'available' | 'unavailable' | 'unknown';

/**
 * 实际接受的原始样本（accepted raw sample）。
 *
 * - 坐标允许 screen→world 转换，但只保存转换后实际接受的点。
 * - pressure 为可选；缺失保持缺失，有限越界值按原值保留（不在文档层 clamp）。
 * - 非法/非有限值在构造阶段拒绝，不在此类型层表达。
 */
export type AcceptedSample = Readonly<{
  sequence: number;
  x: number;
  y: number;
  pressure?: number;
  time: number;
  phase: SamplePhase;
  source: InputSource;
}>;

/**
 * 落笔时对当前笔不可变的笔刷快照。
 * 按契约不包含 dash、pressureMultiplier 或任何 PF 算法参数。
 */
export type BrushSnapshot = Readonly<{
  color: string;
  nominalSize: number;
  opacity: number;
  pressureMode: PressureMode;
  presetRevision: number;
}>;

/** 所有文档对象共享的基字段：稳定 id、对象修订、局部几何到文档的变换及变换修订。 */
type ObjectBase = {
  objectId: string;
  objectRevision: number;
  transform: AffineTransform;
  transformRevision: number;
};

/**
 * 自由笔对象。
 * - samples 为 accepted raw 的只读序列；不持久化预测/插值/轮廓缓存。
 * - resolvedPressureMode 在 begin 解析并整笔锁定。
 * - samplesRevision/brushRevision 用于派生几何缓存失效；缓存本身不入文档。
 */
export type FreehandObject = Readonly<
  ObjectBase & {
    kind: 'freehand';
    commitId: string;
    samples: readonly AcceptedSample[];
    brushSnapshot: BrushSnapshot;
    resolvedPressureMode: ResolvedPressureMode;
    samplesRevision: number;
    brushRevision: number;
  }
>;

/** 形状独立样式；dash 仅形状拥有，自由笔无 dash。 */
export type ShapeStyle = Readonly<{
  color: string;
  width: number;
  opacity: number;
  dash?: readonly number[];
  fill?: string;
}>;

/** 首期形状类型集合。 */
export type ShapeType = 'line' | 'rect' | 'ellipse' | 'polygon' | 'bezier';

/** 形状对象；points 为局部坐标的真实控制点/顶点，不烘焙对象变换。 */
export type ShapeObject = Readonly<
  ObjectBase & {
    kind: 'shape';
    shapeType: ShapeType;
    points: readonly Point[];
    style: ShapeStyle;
  }
>;

/** 图片对象；使用局部 bounds，不携带 Skia descriptor。 */
export type ImageObject = Readonly<
  ObjectBase & {
    kind: 'image';
    src: string;
    resourceId?: string;
    localBounds: Bounds;
  }
>;

/** 文字对象；使用局部 bounds 与真实文本内容，不含平台渲染句柄。 */
export type TextObject = Readonly<
  ObjectBase & {
    kind: 'text';
    content: string;
    fontSize: number;
    color: string;
    localBounds: Bounds;
  }
>;

/** 文档对象联合；按 kind 区分。 */
export type DocumentObject = FreehandObject | ShapeObject | ImageObject | TextObject;

/**
 * 编辑器文档。
 *
 * - objects 有序，顺序即绘制顺序；objectId 在文档内唯一（由构造函数保证）。
 * - documentRevision 单调递增，undo/redo 只改变对象内容而不使该修订回退。
 */
export type EditorDocument = Readonly<{
  schemaVersion: typeof LAYERED_SCHEMA_VERSION;
  documentRevision: number;
  objects: readonly DocumentObject[];
}>;

/**
 * 落笔时的压力模式解析（纯函数，begin resolver）。
 *
 * - 显式 real/simulated/constant 原样返回，不受来源与能力影响。
 * - auto：pen 且 capability 非 unavailable → real；mouse/touch → simulated；
 *   native 且 capability 为 available → real，否则（unavailable/unknown）→ simulated。
 * - 只依据来源与能力，不读取压力值、恒定值或变化率来做判断。
 */
export function resolvePressureMode(
  requestedMode: PressureMode,
  source: InputSource,
  capability: PressureCapability
): ResolvedPressureMode {
  // 显式模式直接锁定。
  if (requestedMode !== 'auto') {
    return requestedMode;
  }

  // mouse/touch 一律模拟压力，即使报告正压力。
  if (source === 'mouse' || source === 'touch') {
    return 'simulated';
  }

  // 原生语义来源：只有明确可用才使用真实压力。
  if (source === 'native') {
    return capability === 'available' ? 'real' : 'simulated';
  }

  // pen：能力非 unavailable（含 unknown）即使用真实压力；明确不可用才模拟。
  return capability === 'unavailable' ? 'simulated' : 'real';
}
