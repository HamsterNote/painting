import { normalizeDrawingValue } from '../model/strokeMigration';
import {
  DRAWING_STROKE_SCHEMA_VERSION,
  type DrawingStrokeV2,
  type DrawingValueV2,
} from '../model/strokes';

/**
 * 读取持久化绘图数据时发现的非致命问题。
 *
 * core 不拒绝读取未知数据，以便宿主能够展示或记录诊断；返回的 document 始终是
 * 可由当前 V2 core 使用的规范化副本。
 */
export type DrawingDocumentDiagnostic = Readonly<{
  type: 'unsupported-schema-version';
  schemaVersion: unknown;
}>;

/** V2 文档读取结果。diagnostics 不可变，且不会包含输入对象的引用。 */
export type ReadDrawingDocumentResult = Readonly<{
  document: DrawingValueV2;
  diagnostics: readonly DrawingDocumentDiagnostic[];
}>;

function hasOwnSchemaVersion(value: unknown): value is Record<'schemaVersion', unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'schemaVersion')
  );
}

function copyV2Stroke(stroke: DrawingStrokeV2): DrawingStrokeV2 {
  // 写操作只接受 V2；重设版本并浅复制，确保 core 生成的笔迹总是标记为当前版本。
  return { ...stroke, schemaVersion: DRAWING_STROKE_SCHEMA_VERSION } as DrawingStrokeV2;
}

/**
 * 将任意持久化输入读取为当前唯一支持的 V2 文档。
 *
 * 缺失 schemaVersion 的旧 V1 数据以及显式 V2 数据都会交给既有迁移器处理，且绝不
 * 修改输入。显式的非 V2 版本仍会得到安全的 V2 规范化结果，但同时产生诊断，防止
 * 调用方将未来版本误认为 V1 而静默降级。
 */
export function readDrawingDocument(input: unknown): ReadDrawingDocumentResult {
  const diagnostics: DrawingDocumentDiagnostic[] = [];
  if (hasOwnSchemaVersion(input) && input.schemaVersion !== DRAWING_STROKE_SCHEMA_VERSION) {
    diagnostics.push({
      type: 'unsupported-schema-version',
      schemaVersion: input.schemaVersion,
    });
  }

  return {
    document:
      input !== null && typeof input === 'object'
        ? normalizeDrawingValue(input as { readonly strokes?: readonly unknown[] })
        : normalizeDrawingValue(undefined),
    diagnostics,
  };
}

/**
 * 在文档末尾追加一条 V2 笔迹，不改变原 document 或 strokes 数组。
 *
 * ID 可以重复：本模块将重复 ID 视为有序条目；仅 update/remove 会命中从前到后的第一条。
 */
export function addStroke(document: DrawingValueV2, stroke: DrawingStrokeV2): DrawingValueV2 {
  return {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes: [...document.strokes, copyV2Stroke(stroke)],
  };
}

/**
 * 以 V2 笔迹替换其同 ID 的第一条现有笔迹，并保持其余笔迹的相对顺序。
 * 未找到目标时返回原 document 引用。
 */
export function updateStroke(document: DrawingValueV2, stroke: DrawingStrokeV2): DrawingValueV2 {
  const index = document.strokes.findIndex(({ id }) => id === stroke.id);
  if (index === -1) {
    return document;
  }

  const strokes = [...document.strokes];
  strokes[index] = copyV2Stroke(stroke);
  return {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes,
  };
}

/**
 * 删除指定 ID 的第一条笔迹，并保持其余笔迹顺序。
 * 未找到目标时返回原 document 引用。
 */
export function removeStroke(document: DrawingValueV2, id: string): DrawingValueV2 {
  const index = document.strokes.findIndex((stroke) => stroke.id === id);
  if (index === -1) {
    return document;
  }

  return {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes: [...document.strokes.slice(0, index), ...document.strokes.slice(index + 1)],
  };
}

/**
 * 清空文档中的笔迹。已经为空的文档无需产生新对象，直接保留原 document 引用。
 */
export function clearStrokes(document: DrawingValueV2): DrawingValueV2 {
  if (document.strokes.length === 0) {
    return document;
  }

  return {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes: [],
  };
}
