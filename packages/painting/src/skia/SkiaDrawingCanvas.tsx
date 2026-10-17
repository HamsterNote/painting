import { Fragment, type ReactElement } from 'react';
import {
  Canvas,
  DashPathEffect,
  FillType,
  Fill,
  Group,
  Glyphs,
  Image,
  ImageShader,
  Paragraph,
  Path,
  Skia,
} from '@shopify/react-native-skia';
import { createViewportAffine, toSkiaMatrix3 } from '../viewport';
import { createFrameDrawBudget, type FrameDrawBudget } from '../core/frameBudget';
import type { DrawingFrame, DrawingFrameEntry } from '../core/drawingFrame';
import {
  describeFrameScreenOverlays,
  describeScreenOverlays,
  describeSkiaFrameEntries,
  describeSkiaDocument,
  type ScreenOverlayDescriptor,
  type SkiaFrameFillRegionDescriptor,
  type SkiaFrameFragmentDescriptor,
  type SkiaFrameImageDescriptor,
  type SkiaFrameTextDescriptor,
  type SkiaPathDescriptor,
  type SkiaRectDescriptor,
  type SkiaStrokeDescriptor,
} from './descriptors';
import type { SkiaDrawingCanvasProps, SkiaOverlayStyle, SkiaPoint, SkiaStrokeStyle } from './types';

const OVERLAY_CIRCLE_SEGMENTS = 24;
const MAX_PARAGRAPH_LAYOUT_WIDTH = 1_000_000;

function createPath(points: readonly SkiaPoint[], closed: boolean) {
  const first = points[0];
  if (!first) {
    return null;
  }
  const path = Skia.Path.Make();
  path.moveTo(first.x, first.y);
  points.slice(1).forEach((point) => {
    path.lineTo(point.x, point.y);
  });
  if (closed) {
    path.close();
  }
  return path;
}

/** 将一个 core fill-region 的所有 island/hole 合并为一个显式 nonzero SkPath。 */
function createCompoundFillPath(descriptor: SkiaFrameFillRegionDescriptor) {
  const path = Skia.Path.Make();
  // 不依赖 Skia 默认值：core 的 fillRule 是 nonzero，洞的 winding 由 core 认证。
  path.setFillType(FillType.Winding);
  for (const polygon of descriptor.polygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      const first = ring[0];
      if (!first) continue;
      path.moveTo(first.x, first.y);
      ring.slice(1).forEach((point) => {
        path.lineTo(point.x, point.y);
      });
      path.close();
    }
  }
  return path;
}

function rotate(point: SkiaPoint, center: SkiaPoint, rotationRad: number): SkiaPoint {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  return {
    x: center.x + point.x * cosine - point.y * sine,
    y: center.y + point.x * sine + point.y * cosine,
  };
}

function pathForRect(rect: SkiaRectDescriptor) {
  const { center, halfWidth, halfHeight, rotationRad } = rect;
  return createPath(
    [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ].map((point) => rotate(point, center, rotationRad)),
    true
  );
}

function pathForCircle(center: SkiaPoint, radius: number) {
  // Screen overlay circle 不属于世界几何/命中共享管线，保留独立且有限的 UI 近似。
  return createPath(
    Array.from({ length: OVERLAY_CIRCLE_SEGMENTS }, (_, index) => {
      const radians = (index / OVERLAY_CIRCLE_SEGMENTS) * Math.PI * 2;
      return { x: center.x + Math.cos(radians) * radius, y: center.y + Math.sin(radians) * radius };
    }),
    true
  );
}

function dashEffect(
  style: Pick<SkiaStrokeStyle, 'dashArray' | 'dashOffset'>,
  phase = style.dashOffset
): ReactElement | null {
  return style.dashArray ? <DashPathEffect intervals={[...style.dashArray]} phase={phase} /> : null;
}

function paintPath(
  renderKey: string,
  path: NonNullable<ReturnType<typeof createPath>>,
  style: SkiaStrokeStyle,
  allowsFill: boolean
): ReactElement {
  return (
    <Fragment key={renderKey}>
      {allowsFill && style.fillColor ? (
        <Path path={path} color={style.fillColor} opacity={style.fillOpacity} style="fill" />
      ) : null}
      {style.strokeWidth > 0 ? (
        <Path
          path={path}
          color={style.color}
          strokeWidth={style.strokeWidth}
          style="stroke"
          strokeCap="round"
          strokeJoin="round"
        >
          {dashEffect(style)}
        </Path>
      ) : null}
    </Fragment>
  );
}

function paintOverlayPath(
  renderKey: string,
  path: NonNullable<ReturnType<typeof createPath>>,
  style: SkiaOverlayStyle,
  allowsFill: boolean
): ReactElement {
  return (
    <Fragment key={renderKey}>
      {allowsFill && style.fillColor && style.fillColor !== 'none' ? (
        <Path path={path} color={style.fillColor} opacity={style.fillOpacity} style="fill" />
      ) : null}
      {style.strokeWidth && style.strokeWidth > 0 ? (
        <Path
          path={path}
          color={style.color}
          strokeWidth={style.strokeWidth}
          style="stroke"
          strokeCap="round"
          strokeJoin="round"
        >
          {style.dashArray ? (
            <DashPathEffect intervals={[...style.dashArray]} phase={style.dashOffset} />
          ) : null}
        </Path>
      ) : null}
    </Fragment>
  );
}

function makeParagraph(
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined,
  text: string,
  fontSize: number,
  sourceColor: string,
  width: number
) {
  // 这只是 legacy/未类型化输入的最终防线；frame ready 资格已在 provider + core budget 决定，
  // 不能依赖这里的拒绝来修正 render/hit 状态。
  if (!fontManager || !fontFamily || !Number.isFinite(width) || width <= 0 || width > MAX_PARAGRAPH_LAYOUT_WIDTH) {
    return null;
  }
  try {
    // provider 必须显式作为第二参数，避免 Web 路径回落到未实现的系统字体查询。
    const builder = Skia.ParagraphBuilder.Make({}, fontManager);
    const color = Skia.Color(sourceColor);
    builder.pushStyle({ fontFamilies: [fontFamily], fontSize, color });
    builder.addText(text);
    const paragraph = builder.build();
    paragraph.layout(width);
    return paragraph;
  } catch {
    // 非法资源与缺失资源同样退到可见几何描述，不在渲染路径重试。
    return null;
  }
}

function renderTextDescriptor(
  descriptor: Extract<SkiaStrokeDescriptor, { kind: 'text' }>,
  renderKey: string,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined
): ReactElement {
  const { rect } = descriptor;
  const x = rect.center.x - rect.halfWidth;
  const y = rect.center.y - rect.halfHeight;
  const width = rect.halfWidth * 2;
  const height = rect.halfHeight * 2;
  const paragraph = makeParagraph(
    fontManager,
    fontFamily,
    descriptor.text,
    descriptor.fontSize,
    descriptor.style.color,
    width
  );
  const fallback = pathForRect(rect);
  if (!paragraph || !fallback) {
    // 没有同步字体资源时以边框和基线表示文字框，确保画布上可见而非静默丢失。
    return fallback ? (
      paintPath(
        renderKey,
        fallback,
        { ...descriptor.style, fillColor: '#E8F0FE', fillOpacity: 0.8 },
        true
      )
    ) : (
      <Fragment key={renderKey} />
    );
  }

  return (
    <Group
      key={renderKey}
      transform={[{ rotate: rect.rotationRad }]}
      origin={rect.center}
      clip={{ x, y, width, height }}
    >
      <Paragraph paragraph={paragraph} x={x} y={y} width={width} />
    </Group>
  );
}

function renderImageDescriptor(
  descriptor: Extract<SkiaStrokeDescriptor, { kind: 'image' }>,
  renderKey: string
): ReactElement {
  const { rect } = descriptor;
  const x = rect.center.x - rect.halfWidth;
  const y = rect.center.y - rect.halfHeight;
  const width = rect.halfWidth * 2;
  const height = rect.halfHeight * 2;
  if (descriptor.image) {
    return (
      <Group key={renderKey} transform={[{ rotate: rect.rotationRad }]} origin={rect.center}>
        <Image image={descriptor.image} x={x} y={y} width={width} height={height} fit="fill" />
      </Group>
    );
  }

  const fallback = pathForRect(rect);
  // 没有 SkImage 时保留准确的几何范围，并绘制浅填充和描边作为明确的资源回退。
  return fallback ? (
    paintPath(
      renderKey,
      fallback,
      {
        ...descriptor.style,
        fillColor: '#F1F3F4',
        fillOpacity: 1,
      },
      true
    )
  ) : (
    <Fragment key={renderKey} />
  );
}

function frameResourceRect(
  descriptor: SkiaFrameTextDescriptor | SkiaFrameImageDescriptor
): SkiaRectDescriptor {
  const layout = descriptor.resourceBox.layout;
  return {
    kind: 'rect',
    id: descriptor.id,
    center: layout.center,
    halfWidth: layout.halfWidth,
    halfHeight: layout.halfHeight,
    rotationRad: layout.rotationRad,
    style: descriptor.style,
  };
}

function resourceClipPath(polygon: readonly SkiaPoint[] | undefined) {
  return polygon && polygon.length >= 3 ? createPath(polygon, true) : null;
}

function renderFrameTextDescriptor(
  descriptor: SkiaFrameTextDescriptor,
  renderKey: string,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined
): ReactElement {
  const program = descriptor.resourceBox.textProgram;
  // partial text 只消费 core 注入的 program，不读 raw/canonical 字符串重新排版。完整有限 text
  // 保留既有 Paragraph 路径，避免普通资源回归。
  const content = program
    ? program.kind === 'empty-text'
      ? <Fragment key={`${renderKey}:resource`} />
      : program.kind === 'paragraph-slice'
        ? (() => {
            const paragraph = makeParagraph(fontManager, fontFamily, program.text, descriptor.fontSize, descriptor.style.color, program.paragraphWidth);
            const cosine = Math.cos(program.rotationRad);
            const sine = Math.sin(program.rotationRad);
            return paragraph ? (
              <Group key={`${renderKey}:resource`} matrix={[cosine, -sine, program.anchor.x, sine, cosine, program.anchor.y, 0, 0, 1]}>
                <Paragraph paragraph={paragraph} x={program.paintOffset.x} y={program.paintOffset.y} width={program.paragraphWidth} />
              </Group>
            ) : <Fragment key={`${renderKey}:resource`} />;
          })()
        : (() => {
            try {
              // 每个 run 的 font 都已由 Web provider 在 core 接纳前预构造；renderer 只作防御性
              // 完整性检查，不再首次调用 Skia.Font 或按 family 匹配。
              const fonts = program.runs.map((run) => {
                if (!run.fontReady || !run.font || !Number.isFinite(run.size) || run.size <= 0 || !Number.isFinite(run.scaleX) || run.scaleX <= 0) {
                  throw new Error('Invalid shaped-run font input.');
                }
                return run.font as never;
              });
              const cosine = Math.cos(program.rotationRad);
              const sine = Math.sin(program.rotationRad);
              return (
                <Group key={`${renderKey}:resource`} matrix={[cosine, -sine, program.anchor.x, sine, cosine, program.anchor.y, 0, 0, 1]}>
                  {program.runs.map((run, runIndex) => (
                    <Glyphs
                      key={`${renderKey}:run:${run.glyphs.length}:${run.glyphs[0]}:${run.positions[0]}:${run.positions[1]}`}
                      font={fonts[runIndex]}
                      x={0}
                      y={0}
                      color={descriptor.style.color}
                      glyphs={Array.from(run.glyphs, (id, glyphIndex) => ({
                        id,
                        pos: { x: run.positions[glyphIndex * 2], y: run.positions[glyphIndex * 2 + 1] },
                      }))}
                    />
                  ))}
                </Group>
              );
            } catch {
              return <Fragment key={`${renderKey}:resource`} />;
            }
          })()
    : renderTextDescriptor(
        { ...descriptor, kind: 'text', rect: frameResourceRect(descriptor) },
        `${renderKey}:resource`,
        fontManager,
        fontFamily
      );
  const clip = resourceClipPath(descriptor.resourceBox.visiblePolygon);
  return clip ? (
    <Group key={renderKey} clip={clip}>{content}</Group>
  ) : content;
}

function renderFrameImageDescriptor(
  descriptor: SkiaFrameImageDescriptor,
  renderKey: string
): ReactElement {
  // partial image 消费 core 给出的 source/destination 映射。destination 是有限窗口，
  // source 明确标识它在完整图片内的位置，绝不把完整图片 re-fit 到 visible AABB。
  const mapped = descriptor.resourceBox.imageMapping;
  const rect = mapped
    ? {
        kind: 'rect' as const,
        id: descriptor.id,
        // 不先构造完整巨大 layout 的 destination，mapped destination 是本分支唯一传给 Skia 的 box。
        ...mapped.destination,
        style: descriptor.style,
      }
    : frameResourceRect(descriptor);
  const content = mapped && descriptor.image ? (() => {
    const x = rect.center.x - rect.halfWidth;
    const y = rect.center.y - rect.halfHeight;
    const width = rect.halfWidth * 2;
    const height = rect.halfHeight * 2;
    // ImageShader 先以有限 destination 计算 full-image 的 fill 映射；额外变换把 shader
    // 采样坐标压回 core 已认证的 source window。因而不会把全图重新 fit 到可见 window。
    const sourceTransform = [
      { translateX: mapped.source.x * width },
      { translateY: mapped.source.y * height },
      { scaleX: mapped.source.width },
      { scaleY: mapped.source.height },
    ];
    return (
      <Group key={`${renderKey}:resource`} transform={[{ rotate: rect.rotationRad }]} origin={rect.center}>
        <Fill>
          <ImageShader
            image={descriptor.image}
            fit="fill"
            rect={{ x, y, width, height }}
            transform={sourceTransform}
          />
        </Fill>
      </Group>
    );
  })() : renderImageDescriptor({ ...descriptor, kind: 'image', rect }, `${renderKey}:resource`);
  const clip = resourceClipPath(descriptor.resourceBox.visiblePolygon);
  return clip ? (
    <Group key={renderKey} clip={clip}>{content}</Group>
  ) : content;
}

function normalizedPressure(pressure: number | undefined): number {
  // 0 是有效的零宽压力；其余越界、缺失或非有限值统一回退为标准宽度。
  return typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1
    ? pressure
    : 1;
}

function renderPressurePath(descriptor: SkiaPathDescriptor, renderKey: string): ReactElement {
  return (
    <Fragment key={renderKey}>
      {descriptor.points.slice(1).map((point, index) => {
        const previous = descriptor.points[index];
        const path = createPath([previous, point], false);
        const strokeWidth = descriptor.style.strokeWidth * normalizedPressure(point.pressure);
        return path && strokeWidth > 0 ? (
          <Path
            key={`${renderKey}:${JSON.stringify(previous)}:${JSON.stringify(point)}`}
            path={path}
            color={descriptor.style.color}
            strokeWidth={strokeWidth}
            style="stroke"
            strokeCap="round"
            strokeJoin="round"
          >
            {dashEffect(descriptor.style)}
          </Path>
        ) : null;
      })}
    </Fragment>
  );
}

function renderFrameFragment(
  descriptor: SkiaFrameFragmentDescriptor,
  renderKey: string,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined
): ReactElement {
  if (descriptor.kind === 'frame-text') {
    return renderFrameTextDescriptor(descriptor, renderKey, fontManager, fontFamily);
  }
  if (descriptor.kind === 'frame-image') {
    return renderFrameImageDescriptor(descriptor, renderKey);
  }
  if (descriptor.kind === 'frame-fill-region') {
    const path = createCompoundFillPath(descriptor);
    // core compound fill 可能含人工 clip 边；一个 region 只 draw 一次 fill，绝不 stroke。
    return descriptor.style.fillColor ? (
      <Path
        key={renderKey}
        path={path}
        color={descriptor.style.fillColor}
        opacity={descriptor.style.fillOpacity}
        style="fill"
      />
    ) : (
      <Fragment key={renderKey} />
    );
  }

  const path = createPath(descriptor.points, descriptor.closed);
  // frame 的每个连续 run/clip fragment 独立创建 path，禁止跨 fragment 自动连线。
  const strokeWidth =
    descriptor.style.strokeWidth * normalizedPressure(descriptor.sourcePressures.end);
  return path && strokeWidth > 0 ? (
    <Path
      key={renderKey}
      path={path}
      color={descriptor.style.color}
      strokeWidth={strokeWidth}
      style="stroke"
      strokeCap="round"
      strokeJoin="round"
    >
      {dashEffect(descriptor.style, descriptor.dashPhase ?? descriptor.style.dashOffset)}
    </Path>
  ) : (
    <Fragment key={renderKey} />
  );
}

function renderWorldStroke(
  descriptor: SkiaStrokeDescriptor,
  renderKey: string,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined
): ReactElement {
  if (descriptor.kind === 'path') {
    const path = createPath(descriptor.points, descriptor.closed);
    if (descriptor.pressureSensitive && descriptor.points.length >= 2) {
      return renderPressurePath(descriptor, renderKey);
    }
    return path ? (
      paintPath(renderKey, path, descriptor.style, descriptor.closed)
    ) : (
      <Fragment key={renderKey} />
    );
  }
  if (descriptor.kind === 'cubic-bezier') {
    const path = createPath(descriptor.contour.points, descriptor.contour.closed);
    return path ? (
      paintPath(renderKey, path, descriptor.style, descriptor.contour.closed)
    ) : (
      <Fragment key={renderKey} />
    );
  }
  if (descriptor.kind === 'rect') {
    const path = pathForRect(descriptor);
    return path ? paintPath(renderKey, path, descriptor.style, true) : <Fragment key={renderKey} />;
  }
  if (descriptor.kind === 'ellipse') {
    const path = createPath(descriptor.contour.points, descriptor.contour.closed);
    return path ? (
      paintPath(renderKey, path, descriptor.style, descriptor.contour.closed)
    ) : (
      <Fragment key={renderKey} />
    );
  }
  if (descriptor.kind === 'text') {
    return renderTextDescriptor(descriptor, renderKey, fontManager, fontFamily);
  }
  return renderImageDescriptor(descriptor, renderKey);
}

function renderOverlay(
  descriptor: ScreenOverlayDescriptor,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined
): ReactElement {
  if (descriptor.kind === 'circle') {
    const path = pathForCircle(descriptor.center, descriptor.radius);
    return path ? (
      paintOverlayPath(descriptor.id, path, descriptor.style, true)
    ) : (
      <Fragment key={descriptor.id} />
    );
  }
  if (descriptor.kind === 'rect') {
    const path = createPath(
      [
        descriptor.origin,
        { x: descriptor.origin.x + descriptor.width, y: descriptor.origin.y },
        { x: descriptor.origin.x + descriptor.width, y: descriptor.origin.y + descriptor.height },
        { x: descriptor.origin.x, y: descriptor.origin.y + descriptor.height },
      ],
      true
    );
    return path ? (
      paintOverlayPath(descriptor.id, path, descriptor.style, true)
    ) : (
      <Fragment key={descriptor.id} />
    );
  }
  if (descriptor.kind === 'text') {
    const width = Math.max(descriptor.fontSize, descriptor.text.length * descriptor.fontSize * 0.6);
    const paragraph = makeParagraph(
      fontManager,
      fontFamily,
      descriptor.text,
      descriptor.fontSize,
      descriptor.style.color ?? '#2878FF',
      width
    );
    if (paragraph) {
      return (
        <Paragraph
          key={descriptor.id}
          paragraph={paragraph}
          x={descriptor.origin.x}
          y={descriptor.origin.y - descriptor.fontSize}
          width={width}
        />
      );
    }
    // overlay 也必须有可见资源回退；小矩形表示无法解析的屏幕文字标注。
    const fallback = createPath(
      [
        { x: descriptor.origin.x, y: descriptor.origin.y - descriptor.fontSize },
        { x: descriptor.origin.x + width, y: descriptor.origin.y - descriptor.fontSize },
        { x: descriptor.origin.x + width, y: descriptor.origin.y },
        descriptor.origin,
      ],
      true
    );
    return fallback ? (
      paintOverlayPath(
        descriptor.id,
        fallback,
        { ...descriptor.style, strokeWidth: descriptor.style.strokeWidth || 1 },
        false
      )
    ) : (
      <Fragment key={descriptor.id} />
    );
  }
  const points = descriptor.kind === 'line' ? [descriptor.from, descriptor.to] : descriptor.points;
  const path = createPath(points, descriptor.kind === 'polyline' && descriptor.closed);
  return path ? (
    paintOverlayPath(
      descriptor.id,
      path,
      descriptor.style,
      descriptor.kind === 'polyline' && descriptor.closed
    )
  ) : (
    <Fragment key={descriptor.id} />
  );
}

/**
 * frame 身份稳定的 world 静态层缓存：只缓存非资源条目（path/rect/ellipse/cubic/fill-region）
 * 的 React 元素及其中的 SkPath。键为 frame 对象本身，frame 变化即整体失效。
 *
 * text/image 作为资源条目永不进入缓存：每次 render 都按当前 getImage/resolveImage/fontManager
 * 重新解析，绝不假定「resolver 身份不变 ⇒ 资源不可变」。因此图像/文本不会 stale。
 *
 * 采用模块级 WeakMap 而非 React hooks：既有 Skia 测试把本组件当纯函数直接调用（不经过 React
 * 运行时），引入 hooks 会破坏该调用约定。WeakMap 以存活 frame 为界，frame 回收后缓存可被回收。
 */
const staticWorldElementCache = new WeakMap<DrawingFrame, Map<number, readonly ReactElement[]>>();

function isResourceFrameEntry(entry: DrawingFrameEntry): boolean {
  return entry.source.stroke.tool === 'text' || entry.source.stroke.tool === 'image';
}

/** 静态条目渲染结果只依赖 entry 与 frame.drawBudget，与资源 resolver / 字体完全无关。 */
function describeStaticWorldElements(
  entry: DrawingFrameEntry,
  budget: FrameDrawBudget
): readonly ReactElement[] {
  return describeSkiaFrameEntries([entry], undefined, undefined, budget).map(
    ({ key, order, fragmentIndex, descriptor }) =>
      renderFrameFragment(
        descriptor,
        `prepared-${key}-${order}-${fragmentIndex}`,
        undefined,
        undefined
      )
  );
}

/**
 * 以「逐条目」方式重建 world 元素，保持与 `describeSkiaFrameEntries(renderableEntries)` 完全
 * 一致的顺序、key、order 与 fragmentIndex：静态条目命中 frame 缓存时零描述、零 SkPath 分配；
 * 资源条目每次都按传入 resolver / 字体重新描述与渲染。
 */
function describeFrameWorldElements(
  frame: DrawingFrame,
  fontManager: SkiaDrawingCanvasProps['fontManager'],
  fontFamily: string | undefined,
  getImage: SkiaDrawingCanvasProps['getImage'],
  resolveImage: SkiaDrawingCanvasProps['resolveImage']
): readonly ReactElement[] {
  let cache = staticWorldElementCache.get(frame);
  if (cache === undefined) {
    cache = new Map<number, readonly ReactElement[]>();
    staticWorldElementCache.set(frame, cache);
  }
  const elements: ReactElement[] = [];
  for (const entry of frame.renderableEntries) {
    if (isResourceFrameEntry(entry)) {
      const descriptors = describeSkiaFrameEntries(
        [entry],
        getImage,
        resolveImage,
        frame.drawBudget
      );
      for (const { key, order, fragmentIndex, descriptor } of descriptors) {
        elements.push(
          renderFrameFragment(
            descriptor,
            `prepared-${key}-${order}-${fragmentIndex}`,
            fontManager,
            fontFamily
          )
        );
      }
      continue;
    }
    // 静态条目 key 在单个 frame 内唯一，且其输出与资源/字体无关，可安全跨 render 复用。
    let cached = cache.get(entry.source.key);
    if (cached === undefined) {
      cached = describeStaticWorldElements(entry, frame.drawBudget);
      cache.set(entry.source.key, cached);
    }
    for (const element of cached) {
      elements.push(element);
    }
  }
  return elements;
}

/**
 * V2 文档的独立 RN Skia 渲染器。Canvas 输入、文档几何、样式和 overlay 均为 DIP。
 * 它未接入 root barrel 或默认路由，调用方须显式从 `@hamster-note/painting/skia` 引用。
 */
export function SkiaDrawingCanvas(props: SkiaDrawingCanvasProps): ReactElement {
  const { overlays = [], fontManager, fontFamily, getImage, resolveImage, canvasProps } = props;
  // TS API 禁止二者混用；若未类型化调用方仍同时传入，frame 分支安全优先，绝不二次变换。
  const frame = 'frame' in props ? props.frame : undefined;
  // 无 frame 时只有 legacy union 成员能合法进入，故这两个值均存在。
  const legacyViewport = frame ? undefined : props.viewport!;
  const legacyDocument = frame ? undefined : props.document!;
  const legacyAffine = frame ? undefined : createViewportAffine(legacyViewport!);
  // legacy 没有 frame origin，但也不能把不可表示的 viewport matrix 直接交给 Skia。
  // 退到 identity 空世界层；screen overlay 仍由 descriptor 的独立数值 gate 处理。
  const legacyBudget = legacyAffine ? createFrameDrawBudget(1_000_000, legacyAffine) : null;
  const worldMatrix = toSkiaMatrix3(
    frame ? frame.localToScreen : (legacyBudget ? legacyAffine! : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })
  );
  // unsafe entry 已由 core 从 renderableEntries 排除；requiresClipping 只是诊断，不得整帧拒绘。
  // world 静态条目按 frame 身份记忆化（资源条目每次重解析），避免 overlay-only rerender 重建
  // 全部 descriptor 与 SkPath；legacy 回退路径没有稳定 frame 身份，保持原有每次重建。
  const frameWorld = frame
    ? describeFrameWorldElements(frame, fontManager, fontFamily, getImage, resolveImage)
    : undefined;
  const legacyStrokes = frame
    ? undefined
    : legacyBudget
      ? describeSkiaDocument(legacyDocument!, getImage, resolveImage)
      : [];
  const screenOverlays = frame
    ? describeFrameScreenOverlays(overlays, frame.localToScreen, frame.drawBudget)
    : describeScreenOverlays(overlays, legacyViewport!);

  return (
    <Canvas {...canvasProps}>
      {/* frame 直接提供唯一 local→screen Matrix；兼容路径才在这里构造 viewport affine。 */}
      <Group matrix={worldMatrix}>
        {frame
          ? frameWorld
          : legacyStrokes!.map((descriptor, index) =>
              renderWorldStroke(descriptor, `document-${index}`, fontManager, fontFamily)
            )}
      </Group>
      {/* overlay 是 world Group 之后的 identity sibling，始终使用已投影的 screen DIP。 */}
      {screenOverlays.map((descriptor) => renderOverlay(descriptor, fontManager, fontFamily))}
    </Canvas>
  );
}
