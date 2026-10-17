/**
 * SkiaFixtureSurface —— 阶段 6 prepared frame 路径的真实 Skia 绘制检验台。
 *
 * 渲染管线（全部来自规定子路径，不经根 barrel、不经相对源码路径）：
 *   `@hamster-note/painting/core`：prepareDrawingDocument → createPreparedDrawingSpatialIndex
 *     → tryCreateDrawingFrame（viewport + layout DIP 尺寸）→ hitTestDrawingFrame（hit probe）
 *   `@hamster-note/painting/skia`：SkiaDrawingCanvas 以 { frame, overlays } 输入渲染。
 *
 * 坐标约定（关键）：
 *   - frame.visibleEntries.geometry 已按 frameOrigin 重基为局部坐标；
 *   - fixture 的 world overlay 以 global world DIP 定义，必须先经
 *     rebaseOverlaysToFrameOrigin 减去 frameOrigin，再交给 renderer 的 localToScreen 投影；
 *   - screen overlay 保持 identity screen DIP，不做任何换算；
 *   - 所有布局/坐标均为 DIP，不读取 PixelRatio。
 *
 * 平台加载时序与阶段 5 相同：native 静态就绪；web 由路由在 LoadSkiaWeb 成功后
 * 动态导入本模块与包级 skia 子路径。
 */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Skia, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import type { SkiaDrawingCanvasProps } from '@hamster-note/painting/skia';
import { WebShapedRunProvider } from '@hamster-note/painting/skia';
import {
  createPreparedDrawingSpatialIndex,
  hitTestDrawingFrame,
  prepareDrawingDocument,
  tryCreateDrawingFrame,
  type DrawingFrame,
  type DrawingViewport,
  type FrameTextProgram,
  type FrameTextRequest,
} from '@hamster-note/painting/core';
import {
  FIXTURE_FONT_BASE64,
  FIXTURE_FONT_FAMILY,
  FIXTURE_IMAGE_BASE64,
  FIXTURE_IMAGE_SRC,
  FIXTURE_SHAPING_ARABIC_FONT_BASE64,
  FIXTURE_SHAPING_ARABIC_FONT_FAMILY,
  FIXTURE_SHAPING_CJK_FONT_BASE64,
  FIXTURE_SHAPING_CJK_FONT_FAMILY,
  FIXTURE_SHAPING_EMOJI_FONT_BASE64,
  FIXTURE_SHAPING_EMOJI_FONT_FAMILY,
  FIXTURE_SHAPING_FONT_FAMILIES,
  FIXTURE_SHAPING_LATIN_FONT_BASE64,
  FIXTURE_SHAPING_LATIN_FONT_FAMILY,
} from './fixtureAssets';
import {
  CLIP_DEMO_MAX_LOCAL_DIP,
  FIXTURE_DOCUMENT,
  FIXTURE_GEOMETRY_HIT_PROBES,
  FIXTURE_JUMP_TARGETS,
  FIXTURE_OBJECT_LEGEND,
  FIXTURE_OVERLAYS,
  FIXTURE_OVERLAY_ROLE_LEGEND,
  FIXTURE_ROLE_OVERLAYS,
  FIXTURE_SPATIAL_ENTRY_LEGEND,
  FIXTURE_TEXT_SHAPING_HIT_PROBES,
  rebaseOverlaysToFrameOrigin,
} from './fixtureContent';

/** 对外暴露的稳定 testID 集合（Web 端映射为 data-testid，供 E2E 引用） */
export const SKIA_FIXTURE_TEST_IDS = {
  root: 'skia-fixture-root',
  canvas: 'skia-fixture-canvas',
  status: 'skia-fixture-status',
  scaleHalf: 'skia-fixture-scale-half',
  scaleOne: 'skia-fixture-scale-one',
  scaleFour: 'skia-fixture-scale-four',
  pan: 'skia-fixture-pan',
  overlays: 'skia-fixture-overlays',
  geometryViewport: 'skia-fixture-geometry-viewport',
  geometryHitProbe: 'skia-fixture-geometry-hit-probe',
  textLayoutBudget: 'skia-fixture-text-layout-budget',
} as const;

/** 视口档位与平移步长（均为 DIP 语义；scale 无量纲） */
const SCALE_STOPS = [0.25, 0.5, 1, 4, 8] as const;
/** 每个缩放档位的稳定 testID（保留既有 half/one/four，新增 quarter/eight） */
const SCALE_TEST_IDS: Record<string, string> = {
  '0.25': 'skia-fixture-scale-quarter',
  '0.5': 'skia-fixture-scale-half',
  '1': 'skia-fixture-scale-one',
  '4': 'skia-fixture-scale-four',
  '8': 'skia-fixture-scale-eight',
};
const PAN_STEP_DIP = 80;

/** 画布区域固定高度（DIP），宽度随容器（窄屏自适应） */
const CANVAS_HEIGHT = 420;

/** hit probe 的屏幕容差（DIP），交给 hitTestDrawingFrame 换算 */
const HIT_PROBE_TOLERANCE_DIP = 8;
const GEOMETRY_PROGRAM_SCENE_KEY = 'geometry-program';
const TEXT_SHAPING_SCENE_KEY = 'text-shaping';

export interface SkiaFixtureSurfaceProps {
  /** 路由注入的包级 SkiaDrawingCanvas（加载时序由路由保证） */
  canvasComponent: ComponentType<SkiaDrawingCanvasProps>;
}

/** 同步解码后的渲染资源：真实字体 provider + 真实 SkImage 像素 */
interface FixtureResources {
  fontManager: SkTypefaceFontProvider;
  image: SkImage;
  imageSize: string;
  shapingProvider: WebShapedRunProvider | null;
  shapingFontFamilies: readonly string[];
  shapingResourceError: string | null;
}

type GlyphReadableTypeface = Readonly<{
  getGlyphIDs?: (text: string, numCodePoints?: number) => ArrayLike<number>;
}>;

/** Web bundle 可能暂时解析旧 package 声明；此局部视图不放宽实际的 6.3 运行时契约。 */
type WebTextRequest = FrameTextRequest & Readonly<{
  paragraphLayoutWidth: number;
  paragraphDirection: 'auto' | 'ltr';
}>;
type WebShapedRunProviderConstructor = new (
  makeParagraph: (request: WebTextRequest) => unknown,
  preflightFont: (typeface: unknown, size: number, scaleX: number) => unknown | null
) => WebShapedRunProvider;

/** Web FreeType 解码成功不足以证明目标字符存在；拒绝把 .notdef 当成 fallback 成功。 */
function missingGlyphReason(typeface: unknown, sample: string): string | null {
  const glyphReader = typeface as GlyphReadableTypeface;
  if (typeof glyphReader.getGlyphIDs !== 'function') {
    return 'typeface 无 getGlyphIDs，无法验证目标 glyph';
  }
  const glyphs = glyphReader.getGlyphIDs(sample, [...sample].length);
  return Array.from(glyphs).some((glyph) => glyph === 0) ? `缺少目标 glyph「${sample}」` : null;
}

/**
 * Web 会解析 packages/painting 的预构建声明；在 lib 尚未重建时其中可能尚未含有
 * `program`。fixture 不放宽契约，而是在挂载 renderer 前同时验证运行时字段并提供
 * 最小的只读局部视图，避免把旧 fragments-only frame 当作阶段 6.3 成功。
 */
type GeometryProgramFrameEntry = DrawingFrame['visibleEntries'][number] & Readonly<{
  program: Readonly<{ fills: readonly unknown[]; strokes: readonly unknown[] }>;
}>;
type GeometryProgramFrame = DrawingFrame & Readonly<{
  visibleEntries: readonly GeometryProgramFrameEntry[];
  renderableEntries: readonly GeometryProgramFrameEntry[];
}>;

function hasGeometryProgramFrame(frame: DrawingFrame | null): frame is GeometryProgramFrame {
  return frame !== null &&
    Array.isArray(frame.renderableEntries) &&
    typeof frame.hasUnresolvedClipping === 'boolean' &&
    frame.visibleEntries.every((entry) => {
      const program = (entry as GeometryProgramFrameEntry).program;
      return program !== null && typeof program === 'object' &&
        Array.isArray(program.fills) && Array.isArray(program.strokes);
    });
}

/**
 * 解码内嵌字体与图片（标准资源路径，与阶段 5 相同）：
 *   Skia.Typeface.MakeFreeTypeFaceFromData + TypefaceFontProvider.registerFont
 *   Skia.Image.MakeImageFromEncoded
 * 同步调用；失败返回明确错误文案而非静默回退，不做任何原型/实例补丁。
 */
function decodeFixtureResources(): FixtureResources {
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBase64(FIXTURE_FONT_BASE64));
  if (!typeface) {
    throw new Error('内嵌字体数据无法解码为 typeface');
  }
  const fontManager = Skia.TypefaceFontProvider.Make();
  fontManager.registerFont(typeface, FIXTURE_FONT_FAMILY);
  const shapingFonts = [
    [FIXTURE_SHAPING_LATIN_FONT_FAMILY, FIXTURE_SHAPING_LATIN_FONT_BASE64, 'á'],
    [FIXTURE_SHAPING_CJK_FONT_FAMILY, FIXTURE_SHAPING_CJK_FONT_BASE64, '世界'],
    [FIXTURE_SHAPING_ARABIC_FONT_FAMILY, FIXTURE_SHAPING_ARABIC_FONT_BASE64, 'مرحبا'],
    // ZWJ 本身无可见 glyph；验证序列中的四个 emoji，完整 ZWJ string 仍会传给 Paragraph。
    [FIXTURE_SHAPING_EMOJI_FONT_FAMILY, FIXTURE_SHAPING_EMOJI_FONT_BASE64, '👨👩👧👦'],
  ] as const;
  const shapingFailures: string[] = [];
  for (const [family, base64, sample] of shapingFonts) {
    if (!base64) {
      shapingFailures.push(`${family}: 内嵌 OFL emoji 子集不可用`);
      continue;
    }
    const shapingTypeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBase64(base64));
    if (!shapingTypeface) {
      shapingFailures.push(`${family}: MakeFreeTypeFaceFromData 失败`);
      continue;
    }
    const glyphFailure = Platform.OS === 'web' ? missingGlyphReason(shapingTypeface, sample) : null;
    if (glyphFailure) {
      shapingFailures.push(`${family}: ${glyphFailure}`);
      continue;
    }
    fontManager.registerFont(shapingTypeface, family);
  }
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(FIXTURE_IMAGE_BASE64));
  if (!image) {
    throw new Error('内嵌 PNG 数据无法解码为 SkImage');
  }
  const shapingResourceError = shapingFailures.length > 0 ? shapingFailures.join('；') : null;
  // 只在 Web 且所有 fallback 资源真实注册后创建 provider；native 不导出 shaping 能力。
  const shapingProvider = Platform.OS === 'web' && !shapingResourceError
    ? new (WebShapedRunProvider as unknown as WebShapedRunProviderConstructor)((request) => {
      // 超预算认证场景固定 LTR/start-left；普通 text 保留 CanvasKit 默认 direction，避免干预
      // Arabic 等既有复杂 shaping。CanvasKit enum 的公开数值为 LTR=1、Start=4。
      const builder = Skia.ParagraphBuilder.Make(
        request.paragraphDirection === 'ltr' ? { textDirection: 1, textAlign: 4 } : {},
        fontManager
      );
      builder.pushStyle({
        fontFamilies: [...FIXTURE_SHAPING_FONT_FAMILIES],
        fontSize: request.fontSize,
        color: Skia.Color('#1A237E'),
      });
      builder.addText(request.text);
      const paragraph = builder.build();
      // 仅把 core 已限额的真实 layout 输入交给 CanvasKit；原始宽度保留在 request 供 metrics
      // 认证，绝不作为 CanvasKit 输入或按 visible AABB 重排。
      paragraph.layout(request.paragraphLayoutWidth);
      // provider 在 prepare 内同步复制 .ref.getShapedLines()；不手动 delete 仍被 raw typeface 引用的对象。
      return paragraph;
    }, (typeface, size, scaleX) => {
      try {
        const font = Skia.Font(typeface as never, size);
        if (!font) return null;
        font.setScaleX(scaleX);
        return font;
      } catch {
        return null;
      }
    })
    : null;
  return {
    fontManager,
    image,
    imageSize: `${image.width()}×${image.height()}`,
    shapingProvider,
    shapingFontFamilies: FIXTURE_SHAPING_FONT_FAMILIES,
    shapingResourceError,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type TextShapingRecord = Readonly<{
  state: 'pending' | 'ready' | 'unsupported';
  cursor: number;
  reason?: string;
}>;

/** provider 的 revision 已包含完整文本和原始 paragraph width；不可改为 substring 或估算 key。 */
function shapingRequestKey(request: FrameTextRequest): string {
  return request.revision;
}

function hasTextRequest(fragment: DrawingFrame['visibleEntries'][number]['fragments'][number]): fragment is DrawingFrame['visibleEntries'][number]['fragments'][number] & Readonly<{
  resourceBox: Readonly<{ textRequest?: FrameTextRequest; textProgram?: FrameTextProgram }>;
}> {
  return 'resourceBox' in fragment && typeof fragment.resourceBox === 'object' && fragment.resourceBox !== null &&
    'textRequest' in fragment.resourceBox;
}

function textRequestsInFrame(frame: DrawingFrame | null): readonly FrameTextRequest[] {
  if (!frame) return [];
  const requests: FrameTextRequest[] = [];
  for (const entry of frame.visibleEntries) {
    for (const fragment of entry.fragments) {
      if (fragment.kind === 'semantic-area' && hasTextRequest(fragment) && fragment.resourceBox.textRequest) {
        requests.push(fragment.resourceBox.textRequest);
      }
    }
  }
  return requests;
}

/** probe 文案只陈述本次真实 frame hit 的返回值；不把预期声明伪装成实际结果。 */
function describeProbeResult(
  probeName: string,
  expected: string,
  point: Readonly<{ x: number; y: number }>,
  hit: ReturnType<typeof hitTestDrawingFrame>
): string {
  const screenPoint = `(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`;
  return hit
    ? `${probeName}：${expected}；实际命中 id=${hit.entry.source.stroke.id} key=${hit.entry.source.key} order=${hit.entry.source.order} status=${hit.entry.status} @ ${screenPoint}`
    : `${probeName}：${expected}；实际未命中 @ ${screenPoint}（unresolved 条目不参与命中）`;
}

export default function SkiaFixtureSurface({ canvasComponent: FixtureCanvas }: SkiaFixtureSurfaceProps) {
  // ===== 资源就绪状态机：解码完成前不渲染 canvas，状态对用户可见 =====
  const [resources, setResources] = useState<FixtureResources | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [textShaping, setTextShaping] = useState<ReadonlyMap<string, TextShapingRecord>>(new Map());
  const shapingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setResources(decodeFixtureResources());
    } catch (error) {
      setResourceError(errorMessage(error));
    }
  }, []);

  useEffect(() => () => {
    if (shapingTimer.current !== null) {
      clearTimeout(shapingTimer.current);
    }
  }, []);

  // ===== 阶段 6 管线：document 静态 → prepare + 空间索引只建一次 =====
  // 任何子路径解析/运行时问题都如实进入错误面板，不崩溃、不假装成功。
  const pipeline = useMemo(() => {
    try {
      const prepared = prepareDrawingDocument(FIXTURE_DOCUMENT);
      const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
      return { ok: true as const, prepared, spatialIndex };
    } catch (error) {
      return { ok: false as const, message: errorMessage(error) };
    }
  }, []);

  // ===== 受控视口（DIP）：scale 档位 + 平移 + 跳转目标 =====
  const [viewport, setViewport] = useState<DrawingViewport>({ scale: 1, tx: 0, ty: 0 });
  /** 当前由跳转控件选择的场景，仅用于如实标记 probe 的适用范围，不参与构帧。 */
  const [activeScene, setActiveScene] = useState<(typeof FIXTURE_JUMP_TARGETS)[number]['key']>('main');
  /** 裁剪演示开关：开启后构帧使用显式演示阈值（非 core 默认），诚实触发 requiresClipping */
  const [clipDemo, setClipDemo] = useState(false);

  // ===== 画布尺寸：onLayout 测量，宽高均为 DIP =====
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const handleCanvasLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCanvasSize({ width, height });
    }
  };

  // ===== 构帧：viewport/canvasSize/clipDemo 变化即重建（frameOrigin 随行 = world rebase） =====
  const resolveTextProgram = useMemo(() => {
    if (Platform.OS !== 'web' || !resources?.shapingProvider) {
      return undefined;
    }
    return (request: FrameTextRequest): FrameTextProgram | null => {
      const record = textShaping.get(shapingRequestKey(request));
      return record?.state === 'ready' ? resources.shapingProvider?.getCached(request) ?? null : null;
    };
  }, [resources, textShaping]);

  const frameOutcome = useMemo(() => {
    if (!pipeline.ok || !canvasSize) {
      return null;
    }
    return tryCreateDrawingFrame({
      prepared: pipeline.prepared,
      spatialIndex: pipeline.spatialIndex,
      viewport,
      layoutSize: canvasSize,
      ...(resolveTextProgram ? { resolveTextProgram } : {}),
      // 裁剪演示使用显式小阈值；默认走 core DEFAULT_MAX_LOCAL_COORDINATE（1e6）
      ...(clipDemo ? { maxLocalCoordinate: CLIP_DEMO_MAX_LOCAL_DIP } : {}),
    });
  }, [pipeline, viewport, canvasSize, clipDemo, resolveTextProgram]);

  const frame: DrawingFrame | null = frameOutcome?.ok ? frameOutcome.frame : null;

  const pendingTextRequests = useMemo(() => textRequestsInFrame(frame), [frame]);
  const textShapingSnapshot = useMemo(() => {
    const records = pendingTextRequests.map((request) => textShaping.get(shapingRequestKey(request)));
    return {
      required: pendingTextRequests.length,
      pending: records.filter((record) => !record || record.state === 'pending').length,
      ready: records.filter((record) => record?.state === 'ready').length,
      unsupported: records.filter((record) => record?.state === 'unsupported').length,
      reasons: records.flatMap((record) => record?.state === 'unsupported' && record.reason ? [record.reason] : []),
    };
  }, [pendingTextRequests, textShaping]);

  // CanvasKit provider 先同步复制完整 Paragraph 的 run，再按 cursor 分批完成。这里故意一次只
  // 推进一个 request，并以 timer 让出主线程；pending 绝不当作 ready 注入 frame。
  useEffect(() => {
    if (Platform.OS !== 'web' || !resources?.shapingProvider || pendingTextRequests.length === 0) {
      return;
    }
    const request = pendingTextRequests.find((candidate) => {
      const state = textShaping.get(shapingRequestKey(candidate))?.state;
      return state !== 'ready' && state !== 'unsupported';
    });
    if (!request || shapingTimer.current !== null) {
      return;
    }
    const key = shapingRequestKey(request);
    const previous = textShaping.get(key);
    shapingTimer.current = setTimeout(() => {
      shapingTimer.current = null;
      try {
        const cursor = previous?.cursor ?? 0;
        const result = resources.shapingProvider!.prepare(
          request,
          resources.shapingProvider!.continuation(request, cursor, 1)
        );
        setTextShaping((current) => {
          const next = new Map(current);
          if (result.state === 'ready') {
            next.set(key, { state: 'ready', cursor });
          } else if (result.state === 'pending') {
            next.set(key, { state: 'pending', cursor: result.cursor });
          } else {
            next.set(key, { state: 'unsupported', cursor, reason: result.reason });
          }
          return next;
        });
      } catch (error) {
        setTextShaping((current) => new Map(current).set(key, {
          state: 'unsupported',
          cursor: previous?.cursor ?? 0,
          reason: errorMessage(error),
        }));
      }
    }, 16);
    return () => {
      if (shapingTimer.current !== null) {
        clearTimeout(shapingTimer.current);
        shapingTimer.current = null;
      }
    };
  }, [pendingTextRequests, resources, textShaping]);

  // 契约门：frame 必须具备阶段 6.3 的 renderable program（fills/strokes）。
  // 包 lib 预构建产物若早于 program 契约（web 解析 lib、native 解析 src），
  // 这里如实报"契约不满足"并拒绝挂载 canvas，绝不退化为读取旧 geometry 字段。
  const frameCompatible = hasGeometryProgramFrame(frame);

  // ===== world overlay 重基：global world DIP → frame 局部坐标（screen overlay 原样） =====
  const allOverlays = useMemo(() => [...FIXTURE_OVERLAYS, ...FIXTURE_ROLE_OVERLAYS], []);
  const frameOverlays = useMemo(
    () => (frame ? rebaseOverlaysToFrameOrigin(allOverlays, frame.frameOrigin) : []),
    [frame, allOverlays]
  );

  // ===== hit probe：与渲染共用同一 frame 的 hitTestDrawingFrame =====
  const [probeText, setProbeText] = useState('尚未探针：点击画布任意位置（仅命中同一 renderable program）');
  const probeGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((event) => {
          if (!frame) {
            setProbeText('frame 不可用，无法探针');
            return;
          }
          const hit = hitTestDrawingFrame(frame, { x: event.x, y: event.y }, HIT_PROBE_TOLERANCE_DIP);
          setProbeText(describeProbeResult('画布点击', '按当前 renderable program 判定', event, hit));
        }),
    [frame]
  );

  /** world probe 先经当前 frame 的 localToScreen 投影，再走同一 hitTestDrawingFrame。 */
  const runGeometryProbe = (probe: (typeof FIXTURE_GEOMETRY_HIT_PROBES)[number]) => {
    if (!frame) {
      setProbeText(`${probe.label}：frame 不可用，无法探针`);
      return;
    }
    const local = { x: probe.point.x - frame.frameOrigin.x, y: probe.point.y - frame.frameOrigin.y };
    const screenPoint = {
      x: frame.localToScreen.a * local.x + frame.localToScreen.c * local.y + frame.localToScreen.tx,
      y: frame.localToScreen.b * local.x + frame.localToScreen.d * local.y + frame.localToScreen.ty,
    };
    const hit = hitTestDrawingFrame(frame, screenPoint, HIT_PROBE_TOLERANCE_DIP);
    setProbeText(describeProbeResult(probe.label, probe.expected, screenPoint, hit));
  };

  const runTextShapingProbe = (probe: (typeof FIXTURE_TEXT_SHAPING_HIT_PROBES)[number]) => {
    if (!frame) {
      setProbeText(`${probe.label}：frame 不可用，无法探针`);
      return;
    }
    const local = { x: probe.point.x - frame.frameOrigin.x, y: probe.point.y - frame.frameOrigin.y };
    const screenPoint = {
      x: frame.localToScreen.a * local.x + frame.localToScreen.c * local.y + frame.localToScreen.tx,
      y: frame.localToScreen.b * local.x + frame.localToScreen.d * local.y + frame.localToScreen.ty,
    };
    const hit = hitTestDrawingFrame(frame, screenPoint, HIT_PROBE_TOLERANCE_DIP);
    setProbeText(describeProbeResult(probe.label, probe.expected, screenPoint, hit));
  };

  /** 画布右缘外 24 DIP 的 self-intersect 延长线位置，验证不会把人工裁剪边当作可命中 stroke。 */
  const runClipEdgeOutsideProbe = () => {
    if (!frame) {
      setProbeText('clip edge outside：frame 不可用，无法探针');
      return;
    }
    const localY = 5000060 - frame.frameOrigin.y;
    const localPoint = { x: frame.localClipRegion.maxX + 24, y: localY };
    const screenPoint = {
      x: frame.localToScreen.a * localPoint.x + frame.localToScreen.c * localPoint.y + frame.localToScreen.tx,
      y: frame.localToScreen.b * localPoint.x + frame.localToScreen.d * localPoint.y + frame.localToScreen.ty,
    };
    const hit = hitTestDrawingFrame(frame, screenPoint, HIT_PROBE_TOLERANCE_DIP);
    setProbeText(describeProbeResult('clip edge outside', '未命中人工裁剪边外', screenPoint, hit));
  };

  /** 图片对象的同步资源查询：仅命中 fixture src（渲染器对未命中走可见几何回退） */
  const getImage = useMemo(
    () => (src: string) => (src === FIXTURE_IMAGE_SRC && resources ? resources.image : null),
    [resources]
  );

  const setScale = (scale: number) => setViewport((prev) => ({ ...prev, scale }));
  const panBy = (dx: number, dy: number) =>
    setViewport((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  const resetPan = () => setViewport((prev) => ({ ...prev, tx: 0, ty: 0 }));
  /** 把目标世界点居中到画布：tx/ty = 画布中心(DIP) − scale × 目标点 */
  const jumpTo = (target: (typeof FIXTURE_JUMP_TARGETS)[number]) => {
    if (!canvasSize) {
      return;
    }
    setViewport((prev) => ({
      scale: prev.scale,
      tx: canvasSize.width / 2 - prev.scale * target.x,
      ty: canvasSize.height / 2 - prev.scale * target.y,
    }));
    setActiveScene(target.key);
  };

  const statusText = `scale ${viewport.scale.toFixed(2)} · tx ${Math.round(viewport.tx)} · ty ${Math.round(viewport.ty)}（DIP）`;
  const shapingBlocked = Platform.OS === 'web' &&
    (resources?.shapingResourceError !== null || (activeScene === TEXT_SHAPING_SCENE_KEY &&
      (textShapingSnapshot.pending > 0 || textShapingSnapshot.unsupported > 0)));
  const frameReady = resources !== null && frame !== null && frameCompatible && !shapingBlocked;
  const geometryViewportText = activeScene === GEOMETRY_PROGRAM_SCENE_KEY && canvasSize && frame
    ? `geometry-program · canvas ${Math.round(canvasSize.width)}×${Math.round(canvasSize.height)} DIP · frame diagnostics ${frame.diagnostics.length} · unresolved ${frame.unresolvedClippingKeys.length}`
    : 'geometry-program 未激活；跳转后显示真实 frame viewport、diagnostics 与 unresolved 计数。';
  const shapingStatusText = Platform.OS !== 'web'
    ? 'compat-static：原生 fixture 不提供或声称 CanvasKit shaping 能力。'
    : resources?.shapingResourceError
      ? `unsupported：${resources.shapingResourceError}`
      : activeScene !== TEXT_SHAPING_SCENE_KEY
        ? 'ready：Web CanvasKit shaping provider 已注册；跳转「文本 shaping」触发真实 partial 请求。'
        : textShapingSnapshot.unsupported > 0
          ? `unsupported：${textShapingSnapshot.reasons.join('；') || 'provider 拒绝真实 shaped lines'}`
          : textShapingSnapshot.pending > 0
            ? `pending：${textShapingSnapshot.pending}/${textShapingSnapshot.required} 个完整 Paragraph 请求分块准备中。`
            : `ready：${textShapingSnapshot.ready}/${textShapingSnapshot.required} 个真实 shaped text program。`;

  // ===== frame 统计：program 与 fragment 按相同 entry status 汇总（纯展示，不重建几何） =====
  // 仅在契约门通过（program 字段真实存在）后读取，避免旧 lib 运行时的字段缺失崩溃。
  const frameStats = useMemo(() => {
    if (!hasGeometryProgramFrame(frame)) {
      return null;
    }
    const byStatus = new Map<string, { entries: number; fills: number; strokes: number; fragments: number }>();
    let fillCount = 0;
    let strokeCount = 0;
    let fragmentCount = 0;
    let shapedRunCount = 0;
    let semanticRegionCount = 0;
    for (const entry of frame.visibleEntries) {
      const status = byStatus.get(entry.status) ?? { entries: 0, fills: 0, strokes: 0, fragments: 0 };
      const fills = entry.program.fills.length;
      const strokes = entry.program.strokes.length;
      const fragments = entry.fragments.length;
      status.entries += 1;
      status.fills += fills;
      status.strokes += strokes;
      status.fragments += fragments;
      byStatus.set(entry.status, status);
      fillCount += fills;
      strokeCount += strokes;
      fragmentCount += fragments;
      for (const fragment of entry.fragments) {
        if (hasTextRequest(fragment) && fragment.resourceBox.textProgram?.kind === 'shaped-runs') {
          shapedRunCount += fragment.resourceBox.textProgram.runs.length;
          semanticRegionCount += fragment.resourceBox.textProgram.semanticRegions.length;
        }
      }
    }
    const textLayoutRequests = textRequestsInFrame(frame).map((request) => ({
      original: request.paragraphWidth,
      layout: (request as WebTextRequest).paragraphLayoutWidth,
    }));
    return { byStatus, fillCount, strokeCount, fragmentCount, shapedRunCount, semanticRegionCount, textLayoutRequests };
  }, [frame]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View testID={SKIA_FIXTURE_TEST_IDS.root} style={styles.container}>
        {/* 头部：说明用途与验证范围 */}
        <View style={styles.header}>
          <Text style={styles.title}>Skia Drawing Fixture（阶段 6 frame 路径）</Text>
          <Text style={styles.subtitle}>
            prepared document → 空间索引 → tryCreateDrawingFrame → 包级 SkiaDrawingCanvas；非默认路由，不替代 legacy 画布。
          </Text>
          {/* 资源状态：真实解码结果可见，成功前不声称就绪 */}
          <Text
            testID="skia-fixture-resources"
            style={[styles.resourceNote, resourceError ? styles.resourceError : styles.resourceOk]}
          >
            {resourceError
              ? `资源解码失败：${resourceError}`
              : resources
                ? `资源就绪：字体 ${FIXTURE_FONT_FAMILY}（TypefaceFontProvider 注册，真实 glyph）· 图片 ${resources.imageSize} PNG（真实像素）`
                : '正在解码内嵌字体与图片资源…'}
          </Text>
          <Text
            testID="skia-fixture-text-shaping-status"
            style={[styles.resourceNote, shapingStatusText.startsWith('unsupported') ? styles.resourceError : styles.resourceOk]}
          >
            文本 shaping：{shapingStatusText}
          </Text>
          <Text testID="skia-fixture-text-shaping-capability" style={styles.note}>
            仅 Web：ParagraphBuilder 使用注册名 fallback chain [{resources?.shapingFontFamilies.join(', ') ?? '-'}]，读取已 layout Paragraph 的真实 CanvasKit shaped runs；不使用 substring、长度估算或 FontMgr.matchFamilyStyle。
          </Text>
          {/* frame 管线状态：prepare/index 失败时如实显示（不崩溃） */}
          {!pipeline.ok ? (
            <Text testID="skia-fixture-frame-error" style={[styles.resourceNote, styles.resourceError]}>
              frame 管线初始化失败：{pipeline.message}
            </Text>
          ) : null}
          {frameOutcome && !frameOutcome.ok ? (
            <Text testID="skia-fixture-frame-error" style={[styles.resourceNote, styles.resourceError]}>
              构帧失败：{frameOutcome.diagnostics.map((d) => d.type).join(', ') || 'unknown'}
            </Text>
          ) : null}
          {frame !== null && !frameCompatible ? (
            <Text testID="skia-fixture-frame-error" style={[styles.resourceNote, styles.resourceError]}>
              frame 契约不满足：缺少 renderableEntries/program（包 lib 预构建产物过旧，需重建 packages/painting）
            </Text>
          ) : null}
        </View>

        {/* 画布区域：frame 与资源就绪后才挂载；Tap 手势驱动 hit probe */}
        <View style={styles.canvasWrap} onLayout={handleCanvasLayout}>
          {frameReady && resources && frame && frameCompatible ? (
            <GestureDetector gesture={probeGesture}>
              <View testID={SKIA_FIXTURE_TEST_IDS.canvas} style={canvasSize ?? undefined}>
                <FixtureCanvas
                  frame={frame}
                  overlays={frameOverlays}
                  fontManager={resources.fontManager}
                  fontFamily={FIXTURE_FONT_FAMILY}
                  getImage={getImage}
                  canvasProps={{ style: canvasSize ?? undefined }}
                />
              </View>
            </GestureDetector>
          ) : (
            <View style={styles.canvasPlaceholder}>
              <Text style={styles.canvasPlaceholderText}>
                {resourceError || !pipeline.ok || (frameOutcome && !frameOutcome.ok)
                  ? '资源或 frame 不可用，canvas 未挂载'
                  : shapingBlocked
                    ? textShapingSnapshot.unsupported > 0 || resources?.shapingResourceError
                      ? '文本 shaping unsupported，canvas 未挂载'
                      : '文本 shaping 准备中，canvas 暂未挂载'
                  : '资源准备中，canvas 暂未挂载'}
              </Text>
            </View>
          )}
        </View>

        {/* frame diagnostics：origin / 可见数 / 诊断 / 裁剪诚实状态 / hit probe */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>frame diagnostics</Text>
          <View style={styles.row}>
            <Text style={styles.label}>origin（world DIP）</Text>
            <Text testID="skia-fixture-frame-origin" style={styles.value}>
              {frame ? `(${Math.round(frame.frameOrigin.x)}, ${Math.round(frame.frameOrigin.y)})` : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>geometry viewport</Text>
            <Text testID={SKIA_FIXTURE_TEST_IDS.geometryViewport} style={[styles.value, styles.probeValue]}>
              {geometryViewportText}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>可见 / 可绘 / 准备</Text>
            <Text testID="skia-fixture-frame-visible" style={styles.value}>
              {frame && frameCompatible && pipeline.ok
                ? `${frame.visibleEntries.length} / ${frame.renderableEntries.length} / ${pipeline.prepared.entries.length}`
                : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>program fill / stroke / fragment</Text>
            <Text testID="skia-fixture-frame-fragments" style={styles.value}>
              {frame && frameStats
                ? `${frameStats.fillCount} / ${frameStats.strokeCount} / ${frameStats.fragmentCount}`
                : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>shaped run / semantic region</Text>
            <Text testID="skia-fixture-text-shaping-runs" style={styles.value}>
              {frameStats ? `${frameStats.shapedRunCount} / ${frameStats.semanticRegionCount}` : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>program 状态汇总 / unresolved</Text>
            <Text testID="skia-fixture-frame-status" style={[styles.value, styles.probeValue]}>
              {frameStats
                ? `${[...frameStats.byStatus.entries()].map(([status, counts]) => `${status} e${counts.entries}/f${counts.fills}/s${counts.strokes}/g${counts.fragments}`).join(' · ')} / ${frame?.unresolvedClippingKeys.length ?? 0}`
                : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>局部预算</Text>
            <Text testID="skia-fixture-frame-budget" style={styles.value}>
              {frame ? `${frame.maxLocalCoordinate} DIP${clipDemo ? '（演示阈值）' : '（core 默认）'}` : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>diagnostics</Text>
            <Text testID="skia-fixture-frame-diagnostics" style={[styles.value, styles.probeValue]}>
              {frame ? (frame.diagnostics.length > 0 ? frame.diagnostics.map((d) => `${d.type}${d.entryKey !== undefined ? `#${d.entryKey}` : ''}${d.reason ? `:${d.reason}` : ''}`).join(', ') : '无') : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>hit probe</Text>
            <Text testID="skia-fixture-hit-probe" style={[styles.value, styles.probeValue]}>
              {probeText}
            </Text>
          </View>
          {frameCompatible && frame?.hasUnresolvedClipping ? (
            <Text testID="skia-fixture-frame-unresolved" style={styles.clippingNote}>
              未解决裁剪：keys=[{frame.unresolvedClippingKeys.join(', ')}] 无法安全表达，如实不渲染、不参与命中——这不是「已裁剪完成」。
            </Text>
          ) : null}
          {frameCompatible && frame?.requiresClipping && !frame.hasUnresolvedClipping ? (
            <Text testID="skia-fixture-frame-clipping" style={styles.clipOkNote}>
              本帧包含真实几何裁剪/分段（已安全完成），renderer 仅消费 renderable program。
            </Text>
          ) : null}
          <Text testID="skia-fixture-geometry-capability" style={styles.note}>
            partial cubic 由认证曲线细分、旋转 ellipse 由认证 contour 产出安全 program；partial text/image 走局部 resource clip。复杂闭合填充以一次 nonzero program 绘制，人工裁剪边不进入 stroke program；这不承诺无视觉误差。
          </Text>
          <Text testID="skia-fixture-clip-scene-note" style={styles.note}>
            资源裁剪场景（跳转「资源裁剪」）：点击被裁旋转文本/图片的可见区应命中 status=clipped；
            被裁椭圆也应由 renderable program 命中。若发生真实 unresolved，以上 frame diagnostics 会如实显示且该条目不渲染、不参与命中。
          </Text>
          <Text testID="skia-fixture-geometry-diagnostics" style={styles.note}>
            diagnostics 始终以本帧实际返回为准：unresolved 条目不会出现在 renderableEntries；安全 program 的 fill/stroke/fragment 数和 status 汇总见上方。
          </Text>
          <Text testID={SKIA_FIXTURE_TEST_IDS.geometryHitProbe} style={styles.note} accessibilityLiveRegion="polite">
            {probeText}
          </Text>
          <Text testID="skia-fixture-geometry-hit-probe-note" style={styles.note}>
            geometry probe 实际调用 hitTestDrawingFrame，并只按与 renderer 相同的可见 renderable geometry program 命中；它不是 canvas 像素读取，也不是 native 平台验证。
          </Text>
          <Text testID="skia-fixture-text-shaping-note" style={styles.note}>
            文本 shaping 场景：partial text 的 renderer 与 hit 共享同一 renderable frame text program；run/semantic region 仅为诊断，非像素结论。
          </Text>
          <Text testID="skia-fixture-text-shaping-diagnostics" style={styles.note}>
            scenario={activeScene === TEXT_SHAPING_SCENE_KEY ? 'text-shaping' : 'inactive'} · provider={shapingStatusText} · runs/semantic regions 由 ready frame 中 shaped-runs 实际统计。
          </Text>
          <Text testID={SKIA_FIXTURE_TEST_IDS.textLayoutBudget} style={styles.note}>
            paragraph layout budget：{frameStats?.textLayoutRequests.length
              ? frameStats.textLayoutRequests.map(({ original, layout }) => `original=${original} DIP, layoutInput=${layout} DIP`).join(' · ')
              : '当前 frame 无 text request'}；ready 后 render/hit 仍只消费同一 text program。
          </Text>
        </View>

        {/* 视口控制：缩放档位 + 平移 + 跳转 + 裁剪演示开关 + 当前 DIP 视口读数 */}
        <View style={styles.controls}>
          <View style={styles.controlGroup}>
            <Text style={styles.controlLabel}>缩放</Text>
            <View style={styles.buttonRow}>
              {SCALE_STOPS.map((stop) => {
                const testID = SCALE_TEST_IDS[String(stop)];
                const active = viewport.scale === stop;
                return (
                  <Pressable
                    key={stop}
                    testID={testID}
                    onPress={() => setScale(stop)}
                    accessibilityRole="button"
                    accessibilityLabel={`缩放 ${stop} 倍`}
                    style={({ pressed }) => [
                      styles.button,
                      active && styles.buttonActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={[styles.buttonText, active && styles.buttonTextActive]}>
                      {stop}×
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.controlGroup} testID={SKIA_FIXTURE_TEST_IDS.pan}>
            <Text style={styles.controlLabel}>平移（{PAN_STEP_DIP} DIP/步）</Text>
            <View style={styles.buttonRow}>
              {(
                [
                  { label: '←', dx: -PAN_STEP_DIP, dy: 0, name: '左' },
                  { label: '→', dx: PAN_STEP_DIP, dy: 0, name: '右' },
                  { label: '↑', dx: 0, dy: -PAN_STEP_DIP, name: '上' },
                  { label: '↓', dx: 0, dy: PAN_STEP_DIP, name: '下' },
                ] as const
              ).map(({ label, dx, dy, name }) => (
                <Pressable
                  key={label}
                  testID={`skia-fixture-pan-${name}`}
                  onPress={() => panBy(dx, dy)}
                  accessibilityRole="button"
                  accessibilityLabel={`向${name}平移`}
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.buttonText}>{label}</Text>
                </Pressable>
              ))}
              <Pressable
                testID="skia-fixture-pan-reset"
                onPress={resetPan}
                accessibilityRole="button"
                accessibilityLabel="平移归零"
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonText}>回中</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.controlGroup}>
            <Text style={styles.controlLabel}>视口跳转（目标居中，观察可见条目与 world rebase）</Text>
            <View style={styles.buttonRow}>
              {FIXTURE_JUMP_TARGETS.map((target) => (
                <Pressable
                  key={target.key}
                  testID={target.key === 'geometry-program' ? 'skia-fixture-geometry-jump' : `skia-fixture-jump-${target.key}`}
                  onPress={() => jumpTo(target)}
                  accessibilityRole="button"
                  accessibilityLabel={`跳转到${target.label}`}
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.buttonText}>{target.label}</Text>
                </Pressable>
              ))}
              <Pressable
                testID="skia-fixture-clip-demo"
                onPress={() => setClipDemo((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel="切换裁剪演示"
                style={({ pressed }) => [
                  styles.button,
                  clipDemo && styles.buttonActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.buttonText, clipDemo && styles.buttonTextActive]}>
                  {clipDemo ? '裁剪演示 ON' : '裁剪演示 OFF'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.note}>
              裁剪演示以显式演示阈值 {CLIP_DEMO_MAX_LOCAL_DIP} DIP 构帧（core 默认 1e6），用于诚实触发 requiresClipping 诊断。
            </Text>
          </View>

          <View style={styles.controlGroup} testID="skia-fixture-geometry-hit-probes">
            <Text style={styles.controlLabel}>geometry program 实际 hit probes（跳转「几何 program」后在当前 frame 执行）</Text>
            <View style={styles.buttonRow}>
              {FIXTURE_GEOMETRY_HIT_PROBES.map((probe) => (
                <Pressable
                  key={probe.id}
                  testID={`skia-fixture-geometry-probe-${probe.id}`}
                  onPress={() => runGeometryProbe(probe)}
                  accessibilityRole="button"
                  accessibilityLabel={`几何命中探针 ${probe.label}，预期${probe.expected}`}
                  accessibilityHint="将世界坐标投影到当前 frame，再实际调用 hitTestDrawingFrame"
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.buttonText}>{probe.label}</Text>
                </Pressable>
              ))}
              <Pressable
                testID="skia-fixture-geometry-probe-clip-edge-outside"
                onPress={runClipEdgeOutsideProbe}
                accessibilityRole="button"
                accessibilityLabel="几何命中探针 clip edge outside，预期未命中人工裁剪边外"
                accessibilityHint="使用当前 frame 画布右缘外 24 DIP 的坐标实际调用 hitTestDrawingFrame"
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonText}>clip edge outside</Text>
              </Pressable>
            </View>
            <Text style={styles.note}>
              这些按钮提供稳定的非像素断言入口；结果会写入 geometry hit probe，真实像素仍须由 CanvasKit screenshot/readback 取得。
            </Text>
          </View>

          <View style={styles.controlGroup} testID="skia-fixture-text-shaping-hit-probes">
            <Text style={styles.controlLabel}>Web text shaping 实际 hit probes（跳转「文本 shaping」后执行）</Text>
            <View style={styles.buttonRow}>
              {FIXTURE_TEXT_SHAPING_HIT_PROBES.map((probe) => (
                <Pressable
                  key={probe.id}
                  testID={`skia-fixture-text-shaping-probe-${probe.id}`}
                  onPress={() => runTextShapingProbe(probe)}
                  accessibilityRole="button"
                  accessibilityLabel={`文本 shaping 命中探针 ${probe.label}，预期${probe.expected}`}
                  accessibilityHint="将世界坐标投影到当前 frame，再实际调用 hitTestDrawingFrame"
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.buttonText}>{probe.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.note}>
              这些结果来自同一 renderable frame text program，不从 canvas 像素或可见 AABB 推测命中。
            </Text>
          </View>

          <Text testID={SKIA_FIXTURE_TEST_IDS.status} style={styles.statusText}>
            {statusText}
          </Text>
        </View>

        {/* 对象图例：序号即文档顺序（= prepared key/order），可访问文本供 E2E 核对 */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>对象图例（序号 = 文档顺序，后绘制者在上层）</Text>
          {FIXTURE_OBJECT_LEGEND.map((entry, index) => (
            <Text
              key={entry.tool}
              testID={`skia-fixture-object-${entry.tool}`}
              style={styles.legendLine}
            >
              {index + 1}. {entry.label}
            </Text>
          ))}
          {FIXTURE_SPATIAL_ENTRY_LEGEND.map((entry, index) => (
            <Text
              key={entry.id}
              testID={'geometryTestId' in entry
                ? `skia-fixture-geometry-${entry.geometryTestId}`
                : 'textShapingTestId' in entry
                  ? `skia-fixture-text-shaping-${entry.textShapingTestId}`
                  : `skia-fixture-spatial-${entry.id}`}
              style={styles.legendLine}
            >
              {FIXTURE_OBJECT_LEGEND.length + index + 1}. {entry.label}
            </Text>
          ))}

          {/* overlay 角色图例：每条带稳定 testID，供 E2E 量化各角色的 world/screen 行为 */}
          <View testID={SKIA_FIXTURE_TEST_IDS.overlays} style={styles.overlayRoleList}>
            <Text style={styles.panelTitle}>overlay 角色（world = 重基后随 frame 投影、样式屏幕恒定；screen = 固定屏幕坐标）</Text>
            <Text style={styles.legendLine}>
              基线 marker：橙色虚线 + 端点圆（world）· 左上角品红圆点与「screen」标注（screen）
            </Text>
            {FIXTURE_OVERLAY_ROLE_LEGEND.map((entry) => (
              <Text
                key={entry.role}
                testID={`skia-fixture-overlay-role-${entry.role}`}
                style={styles.legendLine}
              >
                [{entry.space}] {entry.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

/** 视觉与既有 Skia 冒烟一致：暖纸白页面、白卡片、细边框、墨色强调 */
const INK = '#3B5BDB';

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    backgroundColor: '#F5F3EE',
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#24252A',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B6F76',
    lineHeight: 18,
  },
  resourceNote: {
    fontSize: 12,
    lineHeight: 16,
  },
  resourceOk: {
    color: '#2E7D32',
  },
  resourceError: {
    color: '#C0392B',
  },
  canvasWrap: {
    width: '100%',
    height: CANVAS_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E2D8',
    backgroundColor: '#FBFAF6',
    overflow: 'hidden',
  },
  canvasPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasPlaceholderText: {
    fontSize: 13,
    color: '#9A9EA6',
  },
  panel: {
    borderWidth: 1,
    borderColor: '#E6E2D8',
    borderRadius: 10,
    padding: 12,
    gap: 5,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3A3C41',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: '#6B6F76',
  },
  value: {
    fontSize: 13,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  probeValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  clippingNote: {
    fontSize: 12,
    color: '#C0392B',
    lineHeight: 16,
    marginTop: 4,
  },
  clipOkNote: {
    fontSize: 12,
    color: '#2E7D32',
    lineHeight: 16,
    marginTop: 4,
  },
  controls: {
    gap: 10,
  },
  controlGroup: {
    gap: 6,
  },
  controlLabel: {
    fontSize: 12,
    color: '#6B6F76',
  },
  note: {
    fontSize: 12,
    color: '#9A9EA6',
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    minWidth: 48,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  buttonActive: {
    borderColor: INK,
    backgroundColor: 'rgba(59, 91, 219, 0.10)',
  },
  buttonPressed: {
    backgroundColor: '#F1F0EB',
  },
  buttonText: {
    fontSize: 13,
    color: '#3A3C41',
  },
  buttonTextActive: {
    color: INK,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 13,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
  },
  legendLine: {
    fontSize: 12,
    color: '#3A3C41',
    lineHeight: 17,
  },
  overlayRoleList: {
    marginTop: 8,
    gap: 5,
  },
});
