import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

jest.mock(
  '@shopify/react-native-skia',
  () => {
    const React = require('react');
    const component = (name: string) => {
      const MockComponent = ({
        children,
        style,
        ...props
      }: {
        children?: ReactNode;
        style?: unknown;
      }) => React.createElement(name, { ...props, skiaStyle: style }, children);
      MockComponent.displayName = `SkiaMock(${name})`;
      return MockComponent;
    };
    const paragraph = { layout: jest.fn() };
    const builder = {
      pushStyle: jest.fn(),
      addText: jest.fn(),
      build: jest.fn(() => paragraph),
    };
    return {
      Canvas: component('skia-canvas'),
      DashPathEffect: component('skia-dash'),
      Group: component('skia-group'),
      Glyphs: component('skia-glyphs'),
      Fill: component('skia-fill'),
      Image: component('skia-image'),
      ImageShader: component('skia-image-shader'),
      Paragraph: component('skia-paragraph'),
      Path: component('skia-path'),
      Skia: {
        Color: jest.fn((color: string) => color),
        Font: jest.fn(() => ({ setScaleX: jest.fn() })),
        ParagraphBuilder: { Make: jest.fn(() => builder) },
        Path: {
          Make: () => ({
            moveTo: jest.fn(),
            lineTo: jest.fn(),
            cubicTo: jest.fn(),
            close: jest.fn(),
            setFillType: jest.fn(),
          }),
        },
      },
      FillType: { Winding: 0 },
    };
  },
  { virtual: true }
);

jest.mock('../../core/geometry', () => {
  const actual = jest.requireActual<typeof import('../../core/geometry')>('../../core/geometry');
  return {
    ...actual,
    describeDrawingStrokeGeometry: jest.fn(actual.describeDrawingStrokeGeometry),
    describeDrawingGeometryContour: jest.fn(actual.describeDrawingGeometryContour),
  };
});

import {
  SkiaDrawingCanvas,
  describeScreenOverlays,
  describeSkiaDocument,
  describeSkiaStroke,
  type SkiaOverlay,
} from '../../skia';
import { describeFrameScreenOverlays, describeSkiaFrameEntries } from '../../skia/descriptors';
import type { DrawingFrame, DrawingFrameEntry } from '../../core/drawingFrame';
import { describeDrawingGeometryContour, describeDrawingStrokeGeometry } from '../../core/geometry';
import {
  DRAWING_STROKE_SCHEMA_VERSION,
  type DrawingStrokeV2,
  type DrawingValueV2,
} from '../../model/strokes';
import { Skia } from '@shopify/react-native-skia';

function stroke<T extends DrawingStrokeV2['tool']>(
  tool: T,
  partial: Omit<Extract<DrawingStrokeV2, { tool: T }>, 'schemaVersion' | 'id' | 'tool'>
): Extract<DrawingStrokeV2, { tool: T }> {
  return {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    id: `${tool}-1`,
    tool,
    ...partial,
  } as Extract<DrawingStrokeV2, { tool: T }>;
}

function frameWithEntries(
  visibleEntries: DrawingFrame['visibleEntries'],
  localToScreen: DrawingFrame['localToScreen'] = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  requiresClipping = false,
  renderableEntries: DrawingFrame['renderableEntries'] = visibleEntries
): DrawingFrame {
  // 渲染器只读取候选、可渲染集合与局部矩阵；其余 core 字段与这组结构测试无关。
  return { visibleEntries, renderableEntries, localToScreen, requiresClipping } as DrawingFrame;
}

function frameEntry(
  value: DrawingStrokeV2,
  key: number,
  order: number,
  fragments: DrawingFrameEntry['fragments'],
  status: DrawingFrameEntry['status'] = 'rebased',
  program: DrawingFrameEntry['program'] = {
    strokes: fragments.filter(
      (fragment): fragment is Extract<DrawingFrameEntry['fragments'][number], { kind: 'stroke' }> =>
        fragment.kind === 'stroke'
    ),
    fills: [],
    maxDeviation: 0,
  }
): DrawingFrameEntry {
  // fixture 显式构造 core frame contract；普通几何只由 program 提供，不以 geometry 作为输入。
  return {
    source: { key, order, stroke: value },
    status,
    fragments,
    program,
  } as DrawingFrameEntry;
}

function strokeFragment(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSegmentIndex = 0,
  sourceDistanceStart = 0,
  sourceDistanceEnd = Math.hypot(end.x - start.x, end.y - start.y),
  sourcePressures: Readonly<{ start?: number; end?: number }> = {}
): DrawingFrameEntry['fragments'][number] {
  return {
    kind: 'stroke',
    points: [start, end],
    closed: false,
    sourceSegmentIndex,
    sourceSegmentStart: sourceSegmentIndex,
    sourceSegmentEnd: sourceSegmentIndex,
    sourceDistanceStart,
    sourceDistanceEnd,
    sourcePressures,
  };
}

function semanticArea(
  ...points: readonly { x: number; y: number }[]
): DrawingFrameEntry['fragments'][number] {
  return { kind: 'semantic-area', points };
}

function resourceBox(
  tool: 'text' | 'image',
  source: { text?: string; fontSize?: number; resourceId?: string; src?: string },
  center = { x: 10, y: 5 },
  halfWidth = 10,
  halfHeight = 5,
  rotationRad = 0,
  clip?: { minX: number; minY: number; maxX: number; maxY: number },
  imageMapping?: { source: { x: number; y: number; width: number; height: number }; destination: { center: { x: number; y: number }; halfWidth: number; halfHeight: number; rotationRad: number } }
): DrawingFrameEntry['fragments'][number] {
  // 与 core 的完整资源框契约等形；测试不提供或重建任何 compatibility geometry。
  return {
    kind: 'semantic-area',
    points: [
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y + halfHeight },
    ],
    resourceBox: {
      kind: 'resource-box',
      tool,
      layout: { center, halfWidth, halfHeight, rotationRad },
      ...(clip ? {
        visible: {
          clipBounds: clip,
          polygon: [
            { x: clip.minX, y: clip.minY }, { x: clip.maxX, y: clip.minY },
            { x: clip.maxX, y: clip.maxY }, { x: clip.minX, y: clip.maxY },
          ],
        },
      } : {}),
      ...(imageMapping ? { imageMapping } : {}),
      ...(tool === 'text' ? (() => {
        const anchor = {
          x: center.x - halfWidth * Math.cos(rotationRad) + halfHeight * Math.sin(rotationRad),
          y: center.y - halfWidth * Math.sin(rotationRad) - halfHeight * Math.cos(rotationRad),
        };
        const visiblePolygon = clip
          ? [{ x: clip.minX, y: clip.minY }, { x: clip.maxX, y: clip.minY }, { x: clip.maxX, y: clip.maxY }, { x: clip.minX, y: clip.maxY }]
          : [{ x: center.x - halfWidth, y: center.y - halfHeight }, { x: center.x + halfWidth, y: center.y - halfHeight }, { x: center.x + halfWidth, y: center.y + halfHeight }];
        return {
          ...(clip ? { textRequest: { revision: `${source.text ?? ''}:fixture`, text: source.text ?? '', fontSize: source.fontSize ?? 12, paragraphOrigin: anchor, paragraphWidth: halfWidth * 2, rotationRad, visiblePolygon } } : {}),
          textProgram: { kind: 'paragraph-slice' as const, text: source.text ?? '', anchor, paintOffset: { x: 0, y: 0 }, paragraphWidth: halfWidth * 2, rotationRad, semanticRegions: [{ polygon: visiblePolygon }] },
        };
      })() : {}),
      source,
    },
  } as DrawingFrameEntry['fragments'][number];
}

/** mock 只验证组件 props/结构，不代表真实 Skia 像素输出。 */
function hostNodes(tree: ReactNode): readonly { type: string; props: Record<string, unknown> }[] {
  const nodes: { type: string; props: Record<string, unknown> }[] = [];
  const visit = (node: ReactNode): void => {
    if (!isValidElement(node)) {
      return;
    }
    if (typeof node.type === 'function') {
      visit(
        (node.type as (props: Record<string, unknown>) => ReactElement)(
          node.props as Record<string, unknown>
        )
      );
      return;
    }
    if (typeof node.type === 'string') {
      nodes.push({ type: node.type, props: node.props as Record<string, unknown> });
    }
    Children.forEach(node.props.children, visit);
  };
  visit(tree);
  return nodes;
}

const allTools: DrawingValueV2 = {
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  strokes: [
    stroke('pen', {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    }),
    stroke('line', {
      points: [
        { x: 0, y: 20 },
        { x: 20, y: 20 },
      ],
    }),
    stroke('rect', {
      points: [
        { x: 0, y: 30 },
        { x: 20, y: 50 },
      ],
    }),
    stroke('ellipse', {
      points: [
        { x: 30, y: 30 },
        { x: 50, y: 50 },
      ],
    }),
    stroke('polygon', {
      points: [
        { x: 60, y: 30 },
        { x: 80, y: 50 },
        { x: 60, y: 50 },
      ],
    }),
    stroke('bezier', {
      points: [
        { x: 0, y: 60 },
        { x: 10, y: 80 },
        { x: 30, y: 40 },
        { x: 40, y: 60 },
      ],
    }),
    stroke('text', {
      points: [
        { x: 50, y: 60 },
        { x: 150, y: 100 },
      ],
      text: 'multi\nline',
      fontSize: 20,
    }),
    stroke('image', {
      points: [
        { x: 160, y: 60 },
        { x: 260, y: 140 },
      ],
      src: 'memory://missing.png',
    }),
  ],
};

describe('SkiaDrawingCanvas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the eight V2 tools in document order and preserves complex geometry', () => {
    const descriptors = describeSkiaDocument(allTools);

    expect(descriptors.map(({ id, kind }) => [id, kind])).toEqual([
      ['pen-1', 'path'],
      ['line-1', 'path'],
      ['rect-1', 'rect'],
      ['ellipse-1', 'ellipse'],
      ['polygon-1', 'path'],
      ['bezier-1', 'cubic-bezier'],
      ['text-1', 'text'],
      ['image-1', 'image'],
    ]);
    expect(descriptors[0]).toMatchObject({
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    expect(descriptors[5]).toMatchObject({
      kind: 'cubic-bezier',
      points: allTools.strokes[5].points,
    });
  });

  it('uses the default shared contour for high-curvature cubic and rotated ellipse render descriptors', () => {
    const cubic = stroke('bezier', {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 500 },
        { x: 500, y: -500 },
        { x: 500, y: 0 },
      ],
    });
    const ellipse = stroke('ellipse', {
      points: [
        { x: 10, y: 20 },
        { x: 310, y: 38 },
      ],
      rotationRad: 0.31,
    });
    const contour = jest.mocked(describeDrawingGeometryContour);
    const geometry = [describeDrawingStrokeGeometry(cubic), describeDrawingStrokeGeometry(ellipse)];
    const expectedContours = geometry.map((descriptor) =>
      describeDrawingGeometryContour(descriptor!)
    );
    contour.mockClear();
    const descriptors = describeSkiaDocument({
      schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
      strokes: [cubic, ellipse],
    });

    expect(contour).toHaveBeenCalledTimes(2);
    expect(contour).toHaveBeenNthCalledWith(1, geometry[0]);
    expect(contour).toHaveBeenNthCalledWith(2, geometry[1]);
    expect(descriptors[0]).toMatchObject({ kind: 'cubic-bezier', contour: expectedContours[0] });
    expect(descriptors[1]).toMatchObject({ kind: 'ellipse', contour: expectedContours[1] });
    if (descriptors[1]?.kind !== 'ellipse') throw new Error('ellipse 应保留共享 contour。');
    // 大椭圆默认 0.25 DIP sagitta 所需分段并非旧的固定 32 段。
    expect(descriptors[1].contour.points).not.toHaveLength(32);
  });

  it('renders shared contours as polylines instead of Skia cubic commands or a fixed ellipse route', () => {
    const tree = (
      <SkiaDrawingCanvas
        document={{
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          strokes: [
            stroke('bezier', {
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 500 },
                { x: 500, y: -500 },
                { x: 500, y: 0 },
              ],
            }),
            stroke('ellipse', {
              points: [
                { x: 0, y: 0 },
                { x: 300, y: 18 },
              ],
              rotationRad: 0.17,
            }),
          ],
        }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );
    const paths = hostNodes(tree)
      .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
      .map(({ props }) => props.path as { lineTo: jest.Mock; cubicTo: jest.Mock });

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.cubicTo.mock.calls.length === 0)).toBe(true);
    expect(paths.every((path) => path.lineTo.mock.calls.length > 1)).toBe(true);
  });

  it('uses Paragraph with the supplied provider and leaves multiline layout to Skia', () => {
    const provider = {} as never;
    const tree = (
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [allTools.strokes[6]] }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
        fontManager={provider}
        fontFamily="Fixture Sans"
      />
    );
    const builder = jest.mocked(Skia.ParagraphBuilder.Make);
    const nodes = hostNodes(tree);
    const paragraph = nodes.find(({ type }) => type === 'skia-paragraph');
    const group = nodes.find(
      ({ type, props }) => type === 'skia-group' && props.matrix === undefined
    );

    expect(builder).toHaveBeenCalledWith({}, provider);
    expect(builder.mock.results[0].value.pushStyle).toHaveBeenCalledWith({
      fontFamilies: ['Fixture Sans'],
      fontSize: 20,
      color: '#202124',
    });
    expect(builder.mock.results[0].value.addText).toHaveBeenCalledWith('multi\nline');
    expect(paragraph?.props).toMatchObject({ x: 50, y: 60, width: 100 });
    expect(group?.props).toMatchObject({
      origin: { x: 100, y: 80 },
      clip: { x: 50, y: 60, width: 100, height: 40 },
    });
  });

  it('never forwards an over-budget paragraph width to Paragraph.layout on the defensive legacy path', () => {
    const tree = (
      <SkiaDrawingCanvas
        document={{
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          strokes: [stroke('text', {
            points: [{ x: -1_000_000, y: 0 }, { x: 1_000_000, y: 20 }], text: 'complete text', fontSize: 12,
          })],
        }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
        fontManager={{} as never}
        fontFamily="Fixture Sans"
      />
    );

    expect(hostNodes(tree).filter(({ type }) => type === 'skia-paragraph')).toHaveLength(0);
    expect(jest.mocked(Skia.ParagraphBuilder.Make)).not.toHaveBeenCalled();
  });

  it('uses visible paths when text resources are incomplete and keeps missing images visible', () => {
    const tree = (
      <SkiaDrawingCanvas
        document={{
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          strokes: [allTools.strokes[6], allTools.strokes[7]],
        }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );

    const nodes = hostNodes(tree);

    expect(nodes.filter(({ type }) => type === 'skia-paragraph')).toHaveLength(0);
    expect(nodes.filter(({ type }) => type === 'skia-image')).toHaveLength(0);
    expect(nodes.filter(({ type }) => type === 'skia-path').length).toBeGreaterThan(0);
  });

  it('resolves document images by resourceId before an inconsistent src and shares the ready image', () => {
    const readyImage = {} as never;
    const resolveImage = jest.fn((reference: { resourceId?: string; src: string }) =>
      reference.resourceId === 'ready-image' ? readyImage : null
    );
    const getImage = jest.fn(() => ({} as never));
    const document: DrawingValueV2 = {
      schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
      strokes: [
        stroke('image', {
          resourceId: 'ready-image',
          src: 'memory://stale-first',
          points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        }),
        stroke('image', {
          id: 'image-2',
          resourceId: 'ready-image',
          src: 'memory://stale-second',
          points: [{ x: 20, y: 0 }, { x: 30, y: 10 }],
        }),
      ],
    };

    const descriptors = describeSkiaDocument(document, getImage, resolveImage);

    expect(resolveImage).toHaveBeenNthCalledWith(1, {
      resourceId: 'ready-image',
      src: 'memory://stale-first',
    });
    expect(resolveImage).toHaveBeenNthCalledWith(2, {
      resourceId: 'ready-image',
      src: 'memory://stale-second',
    });
    expect(descriptors).toMatchObject([
      { kind: 'image', resourceId: 'ready-image', image: readyImage },
      { kind: 'image', resourceId: 'ready-image', image: readyImage },
    ]);
    expect(getImage).not.toHaveBeenCalled();
  });

  it('lets the ready resolver fall back from a missing ID to src and supports legacy src-only references', () => {
    const srcFallbackImage = {} as never;
    const legacyImage = {} as never;
    const resolveImage = jest.fn((reference: { resourceId?: string; src: string }) => {
      if (reference.resourceId === 'missing-id' && reference.src === 'memory://registered-src') {
        return srcFallbackImage;
      }
      return reference.resourceId === undefined && reference.src === 'memory://legacy-src'
        ? legacyImage
        : null;
    });
    const descriptors = describeSkiaDocument(
      {
        schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
        strokes: [
          stroke('image', {
            resourceId: 'missing-id',
            src: 'memory://registered-src',
            points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          }),
          stroke('image', {
            id: 'legacy-image',
            src: 'memory://legacy-src',
            points: [{ x: 20, y: 0 }, { x: 30, y: 10 }],
          }),
        ],
      },
      undefined,
      resolveImage
    );

    expect(resolveImage).toHaveBeenNthCalledWith(1, {
      resourceId: 'missing-id',
      src: 'memory://registered-src',
    });
    expect(resolveImage).toHaveBeenNthCalledWith(2, { src: 'memory://legacy-src' });
    expect(descriptors).toMatchObject([
      { kind: 'image', image: srcFallbackImage },
      { kind: 'image', image: legacyImage },
    ]);
  });

  it('uses the legacy getImage resolver when resolveImage has no ready image', () => {
    const legacyImage = {} as never;
    const resolveImage = jest.fn(() => null);
    const getImage = jest.fn(() => legacyImage);
    const image = stroke('image', {
      src: 'memory://legacy-get-image',
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    });

    const descriptor = describeSkiaStroke(image, getImage, resolveImage);

    expect(resolveImage).toHaveBeenCalledWith({ src: 'memory://legacy-get-image' });
    expect(getImage).toHaveBeenCalledWith('memory://legacy-get-image');
    expect(descriptor).toMatchObject({ kind: 'image', image: legacyImage });
  });

  it('writes the viewport matrix once on the world group and keeps overlays as sibling primitives', () => {
    const tree = (
      <SkiaDrawingCanvas
        document={allTools}
        viewport={{ scale: 2, tx: 10, ty: -5 }}
        overlays={[
          {
            id: 'screen-line',
            space: 'screen',
            kind: 'line',
            from: { x: 1, y: 2 },
            to: { x: 3, y: 4 },
          },
        ]}
      />
    );
    const nodes = hostNodes(tree);
    const groups = nodes.filter(({ type }) => type === 'skia-group');
    const matrixGroups = groups.filter(({ props }) => props.matrix !== undefined);

    expect(matrixGroups).toHaveLength(1);
    expect(matrixGroups[0]?.props.matrix).toEqual([2, 0, 10, 0, 2, -5, 0, 0, 1]);
    expect(nodes[0]?.type).toBe('skia-canvas');
  });

  it('consumes frame entries directly without describing raw document strokes, and only renders visible entries', () => {
    const visible = stroke('line', {
      id: 'duplicate-id',
      points: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
      ],
      strokeColor: '#00aa00',
    });
    const outside = stroke('line', {
      id: 'duplicate-id',
      points: [
        { x: 900, y: 900 },
        { x: 910, y: 900 },
      ],
      strokeColor: '#cc0000',
    });
    const frame = frameWithEntries([
      frameEntry(visible, 7, 7, [strokeFragment({ x: 1, y: 2 }, { x: 4, y: 2 })]),
    ]);
    const describeGeometry = jest.mocked(describeDrawingStrokeGeometry);

    const tree = <SkiaDrawingCanvas frame={frame} overlays={[]} />;
    const paths = hostNodes(tree).filter(
      ({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke'
    );

    expect(describeGeometry).not.toHaveBeenCalled();
    expect(paths.map(({ props }) => props.color)).toEqual(['#00aa00']);
    expect(paths.map(({ props }) => props.color)).not.toContain(outside.strokeColor);
  });

  it('uses the frame local matrix once and ignores an externally supplied legacy viewport', () => {
    const entryStroke = stroke('line', {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    const frame = frameWithEntries(
      [frameEntry(entryStroke, 3, 3, [strokeFragment({ x: 2, y: 3 }, { x: 4, y: 3 })])],
      { a: 3, b: 0, c: 0, d: 3, tx: 40, ty: -10 }
    );
    // 未类型化 JS 调用方可能同时传入旧 props；实现必须安全地以 frame 为准。
    const unsafeProps = {
      frame,
      document: allTools,
      viewport: { scale: 99, tx: 999, ty: 999 },
    } as unknown as import('../../skia').SkiaDrawingCanvasProps;
    const nodes = hostNodes(<SkiaDrawingCanvas {...unsafeProps} />);
    const matrixGroups = nodes.filter(
      ({ type, props }) => type === 'skia-group' && props.matrix !== undefined
    );

    expect(matrixGroups).toHaveLength(1);
    expect(matrixGroups[0]?.props.matrix).toEqual([3, 0, 40, 0, 3, -10, 0, 0, 1]);
  });

  it('preserves frame entry order when IDs repeat and keys derive from prepared entries', () => {
    const first = stroke('line', {
      id: 'same-id',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      strokeColor: '#112233',
    });
    const second = stroke('line', {
      id: 'same-id',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      strokeColor: '#445566',
    });
    const frame = frameWithEntries([
      frameEntry(first, 12, 4, [strokeFragment({ x: 1, y: 1 }, { x: 2, y: 1 })]),
      frameEntry(second, 4, 12, [strokeFragment({ x: 3, y: 1 }, { x: 4, y: 1 })]),
    ]);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frame} />);

    expect(
      nodes
        .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
        .map(({ props }) => props.color)
    ).toEqual(['#112233', '#445566']);
  });

  it('projects frame world overlays once while keeping screen overlays in identity screen DIP', () => {
    const localToScreen = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: -4 };
    const descriptors = describeFrameScreenOverlays(
      [
        {
          id: 'world',
          space: 'world',
          kind: 'line',
          from: { x: 2, y: 3 },
          to: { x: 4, y: 5 },
          style: { strokeWidth: 3 },
        },
        {
          id: 'screen',
          space: 'screen',
          kind: 'circle',
          center: { x: 7, y: 9 },
          radius: 6,
          style: { strokeWidth: 2 },
        },
      ],
      localToScreen
    );

    expect(descriptors).toEqual([
      expect.objectContaining({
        kind: 'line',
        from: { x: 14, y: 2 },
        to: { x: 18, y: 6 },
        style: expect.objectContaining({ strokeWidth: 3 }),
      }),
      expect.objectContaining({
        kind: 'circle',
        center: { x: 7, y: 9 },
        radius: 6,
        style: expect.objectContaining({ strokeWidth: 2 }),
      }),
    ]);
  });

  it('uses only renderable frame entries when unsafe entries require clipping, preserving safe order', () => {
    const unsafeStroke = stroke('ellipse', {
      id: 'unsafe',
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 18 },
      ],
      strokeColor: '#cc0000',
    });
    const safeStroke = stroke('ellipse', {
      id: 'safe',
      points: [
        { x: 0, y: 0 },
        { x: 80, y: 30 },
      ],
      strokeColor: '#00aa00',
    });
    const unsafeEntry = frameEntry(unsafeStroke, 1, 1, [], 'unresolved');
    const safeEntry = frameEntry(safeStroke, 2, 2, [
      strokeFragment({ x: 0, y: 0 }, { x: 80, y: 30 }),
    ]);
    const frame = frameWithEntries([unsafeEntry, safeEntry], undefined, true, [safeEntry]);
    const tree = <SkiaDrawingCanvas frame={frame} />;
    const paths = hostNodes(tree).filter(
      ({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke'
    );

    expect(paths.map(({ props }) => props.color)).toEqual(['#00aa00']);
  });

  it('does not produce a render descriptor when the public contour API reports cap degradation', () => {
    const ellipse = stroke('ellipse', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    });
    const contour = jest.mocked(describeDrawingGeometryContour);
    const cappedContour = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 1, y: -1 },
      ],
      closed: true,
      maxDeviation: 1,
      requestedMaxDeviation: 0.25,
      isWithinRequestedMaxDeviation: false,
      capped: true,
    };
    contour.mockReturnValueOnce(cappedContour).mockReturnValueOnce(cappedContour);

    const descriptors = describeSkiaDocument({
      schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
      strokes: [ellipse],
    });
    const tree = (
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [ellipse] }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );

    expect(descriptors).toEqual([]);
    expect(hostNodes(tree).filter(({ type }) => type === 'skia-path')).toHaveLength(0);
  });

  it('does not render frame world geometry when renderableEntries is empty', () => {
    const entryStroke = stroke('line', {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    const unsafeEntry = frameEntry(entryStroke, 1, 1, [], 'unresolved');
    const frame = frameWithEntries([unsafeEntry], undefined, true, []);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frame} />);

    expect(nodes.filter(({ type }) => type === 'skia-path')).toHaveLength(0);
  });

  it('derives complete frame runs solely from fragments and never reads compatibility geometry', () => {
    const entry = frameEntry(
      stroke('line', {
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        strokeColor: '#00aa00',
      }),
      9,
      3,
      [
        {
          kind: 'stroke',
          points: [
            { x: 1, y: 2 },
            { x: 2, y: 3 },
            { x: 4, y: 2 },
          ],
          closed: true,
          sourceSegmentIndex: 2,
          sourceSegmentStart: 2,
          sourceSegmentEnd: 3,
          sourceDistanceStart: 4,
          sourceDistanceEnd: 8,
          sourcePressures: { start: 0.1, end: 0.7 },
        } as DrawingFrameEntry['fragments'][number],
      ]
    ) as DrawingFrameEntry & { geometry?: unknown; canonicalLocalGeometry?: unknown };
    Object.defineProperties(entry, {
      geometry: {
        get: () => {
          throw new Error('frame renderer must not read entry.geometry');
        },
      },
      canonicalLocalGeometry: {
        get: () => {
          throw new Error('frame renderer must not read canonicalLocalGeometry');
        },
      },
    });
    Object.defineProperty(entry.source.stroke, 'points', {
      get: () => {
        throw new Error('frame renderer must not read raw stroke points');
      },
    });

    const descriptors = describeSkiaFrameEntries([entry]);
    const tree = <SkiaDrawingCanvas frame={frameWithEntries([entry])} />;

    expect(descriptors).toMatchObject([
      {
        key: 9,
        order: 3,
        fragmentIndex: 0,
        descriptor: {
          kind: 'frame-stroke-fragment',
          points: [
            { x: 1, y: 2 },
            { x: 2, y: 3 },
            { x: 4, y: 2 },
          ],
          closed: true,
          sourceSegmentStart: 2,
          sourceSegmentEnd: 3,
        },
      },
    ]);
    const path = hostNodes(tree).find(
      ({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke'
    )?.props.path as {
      lineTo: jest.Mock;
      close: jest.Mock;
    };
    expect(path.lineTo.mock.calls).toEqual([
      [2, 3],
      [4, 2],
    ]);
    expect(path.close).toHaveBeenCalledTimes(1);
  });

  it('renders clip fragments as separate ordered paths without bridging them', () => {
    const entry = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        strokeColor: '#345678',
      }),
      5,
      8,
      [
        strokeFragment({ x: 0, y: 0 }, { x: 2, y: 0 }, 0, 0, 2),
        strokeFragment({ x: 8, y: 0 }, { x: 10, y: 0 }, 0, 8, 10),
      ],
      'segmented'
    );
    const descriptors = describeSkiaFrameEntries([entry]);
    const paths = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />)
      .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
      .map(({ props }) => props.path as { moveTo: jest.Mock; lineTo: jest.Mock });

    expect(descriptors.map(({ fragmentIndex }) => fragmentIndex)).toEqual([0, 1]);
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.moveTo.mock.calls[0])).toEqual([
      [0, 0],
      [8, 0],
    ]);
    expect(paths.map((path) => path.lineTo.mock.calls[0])).toEqual([
      [2, 0],
      [10, 0],
    ]);
  });

  it('renders one explicit nonzero compound fill path without stroking artificial clip edges', () => {
    const fill = {
      kind: 'fill-region' as const,
      fillRule: 'nonzero' as const,
      polygons: [
        {
          outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          holes: [
            [
              { x: 2, y: 2 },
              { x: 2, y: 8 },
              { x: 8, y: 8 },
              { x: 8, y: 2 },
            ],
          ],
        },
        {
          outer: [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 10 },
            { x: 20, y: 10 },
          ],
          holes: [],
        },
      ],
    };
    const entry = frameEntry(
      stroke('rect', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
        strokeColor: '#111111',
        fillColor: '#aabbcc',
      }),
      4,
      4,
      [
        strokeFragment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0),
        semanticArea({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }),
      ],
      'clipped',
      { strokes: [], fills: [fill], maxDeviation: 0 }
    );
    const descriptors = describeSkiaFrameEntries([entry]);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />);
    const fillPaths = nodes.filter(
      ({ type, props }) => type === 'skia-path' && props.skiaStyle === 'fill'
    );
    const path = fillPaths[0]?.props.path as {
      moveTo: jest.Mock;
      lineTo: jest.Mock;
      close: jest.Mock;
      setFillType: jest.Mock;
    };

    expect(descriptors).toMatchObject([
      {
        descriptor: {
          kind: 'frame-fill-region',
          fillRule: 'nonzero',
          polygons: fill.polygons,
          style: { fillColor: '#aabbcc', fillOpacity: 1 },
        },
      },
    ]);
    // 两个 island 和一个 hole 是同一个 Path 的三个闭合 contour，单次 opacity/paint。
    expect(fillPaths).toHaveLength(1);
    expect(path.setFillType).toHaveBeenCalledWith(0);
    expect(path.moveTo.mock.calls).toEqual([[0, 0], [2, 2], [20, 0]]);
    expect(path.close).toHaveBeenCalledTimes(3);
    expect(
      nodes.filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
    ).toHaveLength(0);
  });

  it('consumes authenticated partial cubic and ellipse program contours without reading raw geometry', () => {
    const partialCubic = frameEntry(
      stroke('bezier', {
        points: [
          { x: 100, y: 100 },
          { x: 120, y: 80 },
          { x: 140, y: 120 },
          { x: 160, y: 100 },
        ],
        strokeColor: '#123456',
      }),
      51,
      2,
      [],
      'clipped',
      {
        strokes: [
          {
            ...strokeFragment({ x: 1, y: 2 }, { x: 3, y: 4 }, 0, 0, 3),
            points: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }],
          } as DrawingFrameEntry['program']['strokes'][number],
        ],
        fills: [],
        maxDeviation: 0.125,
      }
    );
    const partialEllipse = frameEntry(
      stroke('ellipse', {
        points: [{ x: 200, y: 100 }, { x: 260, y: 140 }],
        strokeColor: '#654321',
      }),
      52,
      3,
      [],
      'segmented',
      {
        strokes: [
          {
            ...strokeFragment({ x: 6, y: 2 }, { x: 8, y: 2 }, 4, 6, 8),
            points: [{ x: 6, y: 2 }, { x: 7, y: 1 }, { x: 8, y: 2 }],
          } as DrawingFrameEntry['program']['strokes'][number],
        ],
        fills: [],
        maxDeviation: 0.2,
      }
    );
    for (const entry of [partialCubic, partialEllipse]) {
      Object.defineProperties(entry, {
        geometry: { get: () => { throw new Error('frame writer must not read entry.geometry'); } },
        canonicalLocalGeometry: { get: () => { throw new Error('frame writer must not read canonicalLocalGeometry'); } },
      });
      Object.defineProperty(entry.source.stroke, 'points', {
        get: () => { throw new Error('frame writer must not read raw stroke points'); },
      });
    }

    const descriptors = describeSkiaFrameEntries([partialCubic, partialEllipse]);
    const paths = hostNodes(
      <SkiaDrawingCanvas frame={frameWithEntries([partialCubic, partialEllipse])} />
    )
      .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
      .map(({ props }) => props.path as { moveTo: jest.Mock; lineTo: jest.Mock; cubicTo: jest.Mock });

    expect(descriptors.map(({ descriptor }) => descriptor.kind)).toEqual([
      'frame-stroke-fragment',
      'frame-stroke-fragment',
    ]);
    expect(paths.map((path) => path.moveTo.mock.calls[0])).toEqual([[1, 2], [6, 2]]);
    expect(paths.map((path) => path.lineTo.mock.calls)).toEqual([[[2, 3], [3, 4]], [[7, 1], [8, 2]]]);
    expect(paths.every((path) => path.cubicTo.mock.calls.length === 0)).toBe(true);
  });

  it('does not draw a frame fill-region when the source has no fillColor', () => {
    const entry = frameEntry(
      stroke('rect', {
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        fillColor: 'none',
      }),
      53,
      4,
      [],
      'clipped',
      {
        strokes: [],
        fills: [
          {
            kind: 'fill-region',
            fillRule: 'nonzero',
            polygons: [
              {
                outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
                holes: [],
              },
            ],
          },
        ],
        maxDeviation: 0,
      }
    );

    const descriptors = describeSkiaFrameEntries([entry]);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />);

    expect(descriptors).toMatchObject([
      { descriptor: { kind: 'frame-fill-region', style: { fillColor: undefined } } },
    ]);
    expect(nodes.filter(({ type }) => type === 'skia-path')).toHaveLength(0);
  });

  it('uses the source endpoint pressure rather than clipped intersection pressure', () => {
    const entry = frameEntry(
      stroke('pen', {
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        strokeWidth: 10,
      }),
      6,
      6,
      [
        strokeFragment({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 0, 1, { end: 0 }),
        {
          ...strokeFragment({ x: 2, y: 0 }, { x: 3, y: 0 }, 1, 2, 3, { end: 0.25 }),
          clip: { startT: 0.2, endT: 0.8, insertedPressures: { start: 0.9, end: 0.9 } },
        },
        strokeFragment({ x: 4, y: 0 }, { x: 5, y: 0 }, 2, 4, 5, { end: -1 }),
        strokeFragment({ x: 6, y: 0 }, { x: 7, y: 0 }, 3, 6, 7, { end: Infinity }),
      ]
    );
    const widths = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />)
      .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
      .map(({ props }) => props.strokeWidth);

    expect(widths).toEqual([2.5, 10, 10]);
  });

  it('derives normalized dash phase from sourceDistanceStart as a structural fragment contract', () => {
    const entry = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        dashArray: [3, 2],
        dashOffset: 4,
      }),
      10,
      10,
      [strokeFragment({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 1_000_000_003, 1_000_000_004)]
    );
    const descriptors = describeSkiaFrameEntries([entry]);
    const dashes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />).filter(
      ({ type }) => type === 'skia-dash'
    );

    expect(descriptors[0]).toMatchObject({
      descriptor: { kind: 'frame-stroke-fragment', dashPhase: 2 },
    });
    // 此处仅验证 descriptor 到 DashPathEffect 的结构传递，非 CanvasKit 像素等价测试。
    expect(dashes.map(({ props }) => props)).toEqual([
      expect.objectContaining({ intervals: [3, 2], phase: 2 }),
    ]);
  });

  it('keeps dash phase as a floating modulo sum for negative offsets and huge distances', () => {
    const entryWith = (dashOffset: number, sourceDistanceStart: number) =>
      frameEntry(
        stroke('line', {
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          dashArray: [3, 2],
          dashOffset,
        }),
        13,
        13,
        [
          strokeFragment(
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            0,
            sourceDistanceStart,
            sourceDistanceStart + 1
          ),
        ]
      );
    const phaseOf = (dashOffset: number, sourceDistanceStart: number): number => {
      const descriptor = describeSkiaFrameEntries([entryWith(dashOffset, sourceDistanceStart)])[0]
        ?.descriptor as { dashPhase?: number } | undefined;
      if (descriptor?.dashPhase === undefined) throw new Error('有效 dash 应产生 dashPhase。');
      return descriptor.dashPhase;
    };

    // 两个输入各自先取模，负数和小数都保留声明式浮点相位。
    expect(phaseOf(-0.25, 0.5)).toBeCloseTo(0.25);
    expect(phaseOf(4.5, 0.75)).toBeCloseTo(0.25);

    // 巨大 distance 先对 period 取模再相加，避免大数加法溢出为 Infinity。
    const huge = phaseOf(0.75, 1_000_000_000_000_003);
    expect(huge).toBeCloseTo(3.75);

    // 此处只验证 JS descriptor 的数学与结构传递，不声称 CanvasKit/native 像素连续。
    expect(
      hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entryWith(-0.25, 0.5)])} />)
        .filter(({ type }) => type === 'skia-dash')
        .map(({ props }) => props.phase)
    ).toEqual([0.25]);
  });

  it('advances dash phase per fragment using each fragment sourceDistanceStart', () => {
    const entry = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        dashArray: [3, 2],
        dashOffset: 0,
      }),
      14,
      14,
      [
        strokeFragment({ x: 0, y: 0 }, { x: 3, y: 0 }, 0, 0, 3),
        strokeFragment({ x: 3, y: 0 }, { x: 8, y: 0 }, 0, 3, 8),
        strokeFragment({ x: 8, y: 0 }, { x: 10, y: 0 }, 0, 8, 10),
      ]
    );
    const descriptors = describeSkiaFrameEntries([entry]);
    const phases = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />)
      .filter(({ type }) => type === 'skia-dash')
      .map(({ props }) => props.phase);

    // 各 fragment 依自身 sourceDistanceStart 推进：0 % 5、3 % 5、8 % 5。
    expect(
      descriptors.map(({ descriptor }) => (descriptor as { dashPhase?: number }).dashPhase)
    ).toEqual([0, 3, 3]);
    // 结构传递校验，非 CanvasKit 像素等价测试。
    expect(phases).toEqual([0, 3, 3]);
  });

  it('does not emit a dash effect when the dash array is invalid', () => {
    const entry = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        dashArray: [0, 0],
        dashOffset: 4,
      }),
      15,
      15,
      [strokeFragment({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 1, 2)]
    );
    const descriptor = describeSkiaFrameEntries([entry])[0]?.descriptor as
      { dashPhase?: number; style: { dashArray?: readonly number[] } } | undefined;

    expect(descriptor?.style.dashArray).toBeUndefined();
    expect(descriptor?.dashPhase).toBeUndefined();
    expect(
      hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />).filter(
        ({ type }) => type === 'skia-dash'
      )
    ).toHaveLength(0);
  });

  it('keeps unresolved and empty entries out of frame descriptors while rendering safe fragments only', () => {
    const safe = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        strokeColor: '#00aa00',
      }),
      1,
      1,
      [strokeFragment({ x: 0, y: 0 }, { x: 1, y: 0 })]
    );
    const unresolved = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      }),
      2,
      2,
      [strokeFragment({ x: 0, y: 0 }, { x: 1, y: 1 })],
      'unresolved'
    );
    const empty = frameEntry(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      }),
      3,
      3,
      [],
      'empty'
    );
    const frame = frameWithEntries([safe, unresolved, empty], undefined, true, [safe]);

    expect(describeSkiaFrameEntries([safe, unresolved, empty]).map(({ key }) => key)).toEqual([1]);
    expect(
      hostNodes(<SkiaDrawingCanvas frame={frame} />)
        .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
        .map(({ props }) => props.color)
    ).toEqual(['#00aa00']);
  });

  it('renders complete frame resource boxes from fragment metadata and keeps unavailable resources visible', () => {
    const text = frameEntry(
      stroke('text', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        text: 'contained',
        fontSize: 12,
      }),
      11,
      11,
      [resourceBox('text', { text: 'from fragment', fontSize: 14 }, { x: 10, y: 5 }, 10, 5, 0.2)]
    );
    const image = frameEntry(
      stroke('image', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        src: 'memory://contained',
      }),
      12,
      12,
      [resourceBox('image', { src: 'memory://fragment-image' }, { x: 30, y: 5 }, 10, 5)]
    );
    const complete = [text, image];
    const descriptors = describeSkiaFrameEntries(complete, (src) =>
      src === 'memory://fragment-image' ? ({} as never) : null
    );
    const readyTree = (
      <SkiaDrawingCanvas
        frame={frameWithEntries(complete)}
        fontManager={{} as never}
        fontFamily="Fixture Sans"
        getImage={(src) => (src === 'memory://fragment-image' ? ({} as never) : null)}
      />
    );
    const fallbackTree = <SkiaDrawingCanvas frame={frameWithEntries(complete)} />;

    expect(descriptors.map(({ descriptor }) => descriptor.kind)).toEqual([
      'frame-text',
      'frame-image',
    ]);
    expect(
      hostNodes(readyTree)
        .filter(({ type }) => type === 'skia-paragraph' || type === 'skia-image')
        .map(({ type }) => type)
    ).toEqual(['skia-paragraph', 'skia-image']);
    expect(
      jest.mocked(Skia.ParagraphBuilder.Make).mock.results[0]?.value.addText
    ).toHaveBeenCalledWith('from fragment');
    expect(
      hostNodes(fallbackTree).filter(
        ({ type, props }) =>
          type === 'skia-path' && (props.skiaStyle === 'fill' || props.skiaStyle === 'stroke')
      )
    ).not.toHaveLength(0);
  });

  it('passes frame image resourceId from the resource fragment to the ready resolver', () => {
    const readyImage = {} as never;
    const entry = frameEntry(
      stroke('image', {
        resourceId: 'source-id-must-not-be-read',
        src: 'memory://source-must-not-be-read',
        points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
      }),
      41,
      41,
      [resourceBox('image', { resourceId: 'frame-ready-id', src: 'memory://frame-src' })]
    ) as DrawingFrameEntry & { geometry?: unknown; canonicalLocalGeometry?: unknown };
    Object.defineProperties(entry, {
      geometry: { get: () => { throw new Error('frame descriptor must not read entry.geometry'); } },
      canonicalLocalGeometry: { get: () => { throw new Error('frame descriptor must not read canonicalLocalGeometry'); } },
    });
    const resolveImage = jest.fn((reference: { resourceId?: string; src: string }) =>
      reference.resourceId === 'frame-ready-id' ? readyImage : null
    );

    const descriptors = describeSkiaFrameEntries([entry], undefined, resolveImage);

    expect(resolveImage).toHaveBeenCalledWith({
      resourceId: 'frame-ready-id',
      src: 'memory://frame-src',
    });
    expect(descriptors).toMatchObject([
      {
        descriptor: {
          kind: 'frame-image',
          resourceId: 'frame-ready-id',
          src: 'memory://frame-src',
          image: readyImage,
        },
      },
    ]);
  });

  it('keeps frame descriptors inside the supplied draw budget without reading canonical geometry or raw points', () => {
    const entry = frameEntry(
      stroke('image', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], src: 'memory://source' }),
      70,
      70,
      [resourceBox('image', { resourceId: 'virtual-id', src: 'memory://virtual' }, { x: 5, y: 5 }, 4, 4, 0.1, { minX: 1, minY: 1, maxX: 9, maxY: 9 })]
    ) as DrawingFrameEntry & { geometry?: unknown; canonicalLocalGeometry?: unknown };
    Object.defineProperties(entry, {
      geometry: { get: () => { throw new Error('frame descriptor must not read geometry'); } },
      canonicalLocalGeometry: { get: () => { throw new Error('frame descriptor must not read canonical geometry'); } },
    });
    Object.defineProperty(entry.source.stroke, 'points', { get: () => { throw new Error('frame descriptor must not read raw points'); } });
    const budget = { maxCoordinate: 10, localToScreen: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } } as const;
    const resolveImage = jest.fn(() => ({} as never));

    const descriptors = describeSkiaFrameEntries([entry], undefined, resolveImage, budget);

    expect(resolveImage).toHaveBeenCalledWith({ resourceId: 'virtual-id', src: 'memory://virtual' });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].descriptor).toMatchObject({ kind: 'frame-image', resourceId: 'virtual-id' });
    expect(JSON.stringify(descriptors)).not.toMatch(/Infinity|NaN/);
  });

  it('drops legacy descriptors whose final style or resource numbers exceed the safe draw budget', () => {
    const unsafe = [
      stroke('line', { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], strokeWidth: 1_000_001 }),
      stroke('line', { id: 'dash', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], dashArray: [1_000_001, 1] }),
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'unsafe', fontSize: 1_000_001 }),
      stroke('image', { points: [{ x: 0, y: 0 }, { x: 1_000_001, y: 1 }], src: 'memory://unsafe' }),
    ];

    expect(describeSkiaDocument({ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: unsafe })).toEqual([]);
  });

  it('keeps the legacy entry available but withholds an unsafe viewport matrix and its world descriptors', () => {
    const nodes = hostNodes(
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [stroke('line', { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })] }}
        viewport={{ scale: 1, tx: 1_000_001, ty: 0 }}
      />
    );

    expect(nodes.filter(({ type }) => type === 'skia-path')).toHaveLength(0);
    expect(nodes.find(({ type, props }) => type === 'skia-group' && props.matrix !== undefined)?.props.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('drops overlays whose derived circle or paragraph layout inputs exceed the draw budget', () => {
    const overlays: readonly SkiaOverlay[] = [
      { id: 'circle', space: 'screen', kind: 'circle', center: { x: 999_999, y: 0 }, radius: 2 },
      { id: 'text', space: 'screen', kind: 'text', origin: { x: 0, y: 0 }, text: 'x'.repeat(1_000_000), fontSize: 2 },
    ];

    expect(describeScreenOverlays(overlays, { scale: 1, tx: 0, ty: 0 })).toEqual([]);
  });

  it('renders partial frame resources through an outer shared clip and finite paragraph mapping without raw geometry reads', () => {
    const text = frameEntry(
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], text: 'ignored source', fontSize: 12 }),
      30,
      30,
      [resourceBox('text', { text: 'fragment partial', fontSize: 14 }, { x: 10, y: 5 }, 10, 5, 0.2, { minX: 2, minY: 1, maxX: 14, maxY: 9 })]
    );
    const image = frameEntry(
      stroke('image', { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], src: 'memory://ignored-source' }),
      31,
      31,
      [resourceBox('image', { src: 'memory://fragment-partial' }, { x: 30, y: 5 }, 10, 5, 0.3, { minX: 22, minY: 1, maxX: 34, maxY: 9 })]
    );
    Object.defineProperties(text, {
      geometry: { get: () => { throw new Error('frame descriptor must not read entry.geometry'); } },
      canonicalLocalGeometry: { get: () => { throw new Error('frame descriptor must not read canonicalLocalGeometry'); } },
    });
    Object.defineProperty(text.source.stroke, 'points', { get: () => { throw new Error('frame descriptor must not read raw points'); } });
    const entries = [text, image];
    const descriptors = describeSkiaFrameEntries(entries, (src) => src === 'memory://fragment-partial' ? ({} as never) : null);
    const nodes = hostNodes(
      <SkiaDrawingCanvas
        frame={frameWithEntries(entries)}
        fontManager={{} as never}
        fontFamily="Fixture Sans"
        getImage={(src) => src === 'memory://fragment-partial' ? ({} as never) : null}
      />
    );
    const fallbackNodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries(entries)} />);
    const clipGroups = nodes.filter(({ type, props }) => type === 'skia-group' && props.clip !== undefined);
    // 文本 Paragraph 的完整资源框也会建立内部 clip；这里只验证 partial resource 的外层裁剪。
    const partialClipGroups = clipGroups.filter(
      ({ props }) =>
        props.clip !== undefined &&
        typeof (props.clip as { moveTo?: unknown }).moveTo === 'function'
    );

    expect(descriptors).toMatchObject([
      { descriptor: { kind: 'frame-text', text: 'fragment partial', resourceBox: { layout: { center: { x: 10, y: 5 }, rotationRad: 0.2 }, textProgram: { kind: 'paragraph-slice', paragraphWidth: 20, rotationRad: 0.2 }, visiblePolygon: expect.arrayContaining([{ x: 2, y: 1 }, { x: 14, y: 1 }]) } } },
      { descriptor: { kind: 'frame-image', src: 'memory://fragment-partial', resourceBox: { layout: { center: { x: 30, y: 5 }, rotationRad: 0.3 }, visiblePolygon: expect.arrayContaining([{ x: 22, y: 1 }, { x: 34, y: 1 }]) } } },
    ]);
    expect(partialClipGroups.map(({ props }) => (props.clip as { moveTo: jest.Mock }).moveTo.mock.calls[0])).toEqual([
      [2, 1], [22, 1],
    ]);
    // clip Group 只裁剪 child，既不描边，也不创建 DashPathEffect；资源 rotation 仍在内层 Group。
    expect(nodes.filter(({ type }) => type === 'skia-dash')).toHaveLength(0);
    expect(nodes.filter(({ type, props }) => type === 'skia-group' && props.matrix !== undefined).map(({ props }) => props.matrix)).toContainEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)])
    );
    // Paragraph 采用 core mapping 的原资源 20 DIP 约束，而非共同 clip polygon 的 12 DIP 宽度。
    expect(nodes.find(({ type }) => type === 'skia-paragraph')?.props).toMatchObject({ x: 0, y: 0, width: 20 });
    expect(nodes.filter(({ type, props }) => type === 'skia-group' && props.origin !== undefined).map(({ props }) => props.origin)).toEqual([
      { x: 30, y: 5 },
    ]);
    expect(nodes.filter(({ type }) => type === 'skia-paragraph' || type === 'skia-image').map(({ type }) => type)).toEqual([
      'skia-paragraph', 'skia-image',
    ]);
    // 无同步字体/图片资源时，回退资源框同样只能在 partial 的 outer clip 内出现。
    expect(
      fallbackNodes.filter(
        ({ type, props }) =>
          type === 'skia-group' &&
          props.clip !== undefined &&
          typeof (props.clip as { moveTo?: unknown }).moveTo === 'function'
      )
    ).toHaveLength(2);
    expect(fallbackNodes.filter(({ type, props }) => type === 'skia-path' && (props.skiaStyle === 'fill' || props.skiaStyle === 'stroke')).length).toBeGreaterThan(0);
  });

  it('describes a huge partial text layout through finite fragment mapping without reading canonical or raw geometry', () => {
    const hugePartial = frameEntry(
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'fragment text', fontSize: 12 }),
      88,
      88,
      [{
        kind: 'semantic-area',
        points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }],
        resourceBox: {
          kind: 'resource-box',
          tool: 'text',
          // 完整 layout 保留作审计，故意不能作为 Skia 的 Paragraph 输入。
          layout: { center: { x: 500_000, y: 6 }, halfWidth: 500_000, halfHeight: 6, rotationRad: 0 },
          visible: {
            clipBounds: { minX: 0, minY: 0, maxX: 24, maxY: 12 },
            polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }],
          },
          textRequest: { revision: 'fragment:text', text: 'fragment text', fontSize: 12, paragraphOrigin: { x: 0, y: 0 }, paragraphWidth: 24, rotationRad: 0, visiblePolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          textProgram: { kind: 'paragraph-slice', text: 'fragment text', anchor: { x: 0, y: 0 }, paintOffset: { x: 0, y: 0 }, paragraphWidth: 24, rotationRad: 0, semanticRegions: [{ polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] }] },
          source: { text: 'fragment text', fontSize: 12 },
        },
      } as DrawingFrameEntry['fragments'][number]]
    );
    Object.defineProperties(hugePartial, {
      geometry: { get: () => { throw new Error('frame descriptor must not read entry.geometry'); } },
      canonicalLocalGeometry: { get: () => { throw new Error('frame descriptor must not read canonicalLocalGeometry'); } },
    });
    Object.defineProperty(hugePartial.source.stroke, 'points', { get: () => { throw new Error('frame descriptor must not read raw points'); } });
    const descriptors = describeSkiaFrameEntries([hugePartial]);
    const nodes = hostNodes(
      <SkiaDrawingCanvas frame={frameWithEntries([hugePartial])} fontManager={{} as never} fontFamily="Fixture Sans" />
    );

    expect(descriptors).toMatchObject([{
      descriptor: {
        kind: 'frame-text',
        text: 'fragment text',
        resourceBox: {
          layout: { halfWidth: 500_000 },
          textProgram: { kind: 'paragraph-slice', anchor: { x: 0, y: 0 }, paragraphWidth: 24 },
          visiblePolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }],
        },
      },
    }]);
    // mock 只检查有限组件参数，不主张 native 字形像素结果。
    expect(nodes.find(({ type }) => type === 'skia-paragraph')?.props).toMatchObject({ x: 0, y: 0, width: 24 });
  });

  it('renders each provider-preflighted shaped run through its opaque ready font without reading raw text', () => {
    const firstTypeface = { __typename__: 'Typeface', ref: { getGlyphIDs: jest.fn() }, dispose: jest.fn(), getGlyphIDs: jest.fn() };
    const secondTypeface = { __typename__: 'Typeface', ref: { getGlyphIDs: jest.fn() }, dispose: jest.fn(), getGlyphIDs: jest.fn() };
    const firstFont = { setScaleX: jest.fn() };
    const secondFont = { setScaleX: jest.fn() };
    const entry = frameEntry(
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'must not be read', fontSize: 12 }),
      89,
      89,
      [{
        kind: 'semantic-area', points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }],
        resourceBox: {
          kind: 'resource-box', tool: 'text', layout: { center: { x: 500_000, y: 6 }, halfWidth: 500_000, halfHeight: 6, rotationRad: 0 },
          visible: { clipBounds: { minX: 0, minY: 0, maxX: 24, maxY: 12 }, polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }] },
          textRequest: { revision: 'glyphs', text: 'not used by renderer', fontSize: 12, paragraphOrigin: { x: -500_000, y: 0 }, paragraphWidth: 1_000_000, paragraphLayoutWidth: 1_000_000, rotationRad: 0, visiblePolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          textProgram: { kind: 'shaped-runs', anchor: { x: 0, y: 0 }, rotationRad: 0, runs: [
            { glyphs: new Uint16Array([7]), positions: new Float32Array([3, 4]), offsets: new Uint32Array([0, 1]), typeface: firstTypeface, font: firstFont, fontReady: true, size: 13, scaleX: 1 },
            { glyphs: new Uint16Array([8]), positions: new Float32Array([9, 4]), offsets: new Uint32Array([1, 2]), typeface: secondTypeface, font: secondFont, fontReady: true, size: 17, scaleX: 0.8 },
          ], semanticRegions: [{ polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] }] },
          source: { text: 'not read', fontSize: 12 },
        },
      } as DrawingFrameEntry['fragments'][number]]
    );
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />);

    expect(jest.mocked(Skia.Font)).not.toHaveBeenCalled();
    expect(nodes.filter(({ type }) => type === 'skia-glyphs').map(({ props }) => props.glyphs)).toEqual([
      [{ id: 7, pos: { x: 3, y: 4 } }], [{ id: 8, pos: { x: 9, y: 4 } }],
    ]);
    expect(nodes.find(({ type }) => type === 'skia-paragraph')).toBeUndefined();
  });

  it('defensively suppresses the entire shaped program when a purported ready font is absent', () => {
    const entry = frameEntry(
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'must not fall back', fontSize: 12 }),
      91,
      91,
      [{
        kind: 'semantic-area', points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }],
        resourceBox: {
          kind: 'resource-box', tool: 'text', layout: { center: { x: 12, y: 6 }, halfWidth: 12, halfHeight: 6, rotationRad: 0 },
          visible: { clipBounds: { minX: 0, minY: 0, maxX: 24, maxY: 12 }, polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          textRequest: { revision: 'invalid-font', text: 'not used', fontSize: 12, paragraphOrigin: { x: 0, y: 0 }, paragraphWidth: 24, paragraphLayoutWidth: 24, rotationRad: 0, visiblePolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          textProgram: { kind: 'shaped-runs', anchor: { x: 0, y: 0 }, rotationRad: 0, runs: [{ glyphs: new Uint16Array([7]), positions: new Float32Array([3, 4]), typeface: { __typename__: 'Typeface', ref: { getGlyphIDs: jest.fn() }, dispose() {}, getGlyphIDs() { return []; } }, font: null, fontReady: false, size: 12, scaleX: 1 }], semanticRegions: [{ polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] }] },
          source: { text: 'not used', fontSize: 12 },
        },
      } as DrawingFrameEntry['fragments'][number]]
    );

    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />);

    expect(nodes.filter(({ type }) => type === 'skia-glyphs' || type === 'skia-paragraph')).toEqual([]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('suppresses a shaped program whose fontReady is true but font handle is %s before descriptors and glyphs', (_name, font) => {
    const entry = frameEntry(
      stroke('text', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'must not render', fontSize: 12 }),
      92,
      92,
      [{
        kind: 'semantic-area', points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }],
        resourceBox: {
          kind: 'resource-box', tool: 'text', layout: { center: { x: 12, y: 6 }, halfWidth: 12, halfHeight: 6, rotationRad: 0 },
          visible: { clipBounds: { minX: 0, minY: 0, maxX: 24, maxY: 12 }, polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          textRequest: { revision: 'missing-font', text: 'not used', fontSize: 12, paragraphOrigin: { x: 0, y: 0 }, paragraphWidth: 24, paragraphLayoutWidth: 24, paragraphDirection: 'auto', paragraphAlignment: 'start', rotationRad: 0, visiblePolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] },
          // fontReady 为 true 但 opaque font handle 缺失：core budget gate 必须先行拒绝，
          // descriptor 不输出任何 Glyphs，而不是依赖 renderer 的防御性 !run.font 检查。
          textProgram: { kind: 'shaped-runs', anchor: { x: 0, y: 0 }, rotationRad: 0, runs: [{ glyphs: new Uint16Array([7]), positions: new Float32Array([3, 4]), typeface: {}, font, fontReady: true, size: 12, scaleX: 1 }], semanticRegions: [{ polygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }] }] },
          source: { text: 'not used', fontSize: 12 },
        },
      } as DrawingFrameEntry['fragments'][number]]
    );

    // descriptor 层就不输出 frame-text / shaped program。
    expect(describeSkiaFrameEntries([entry])).toEqual([]);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />);
    expect(nodes.filter(({ type }) => type === 'skia-glyphs' || type === 'skia-paragraph')).toEqual([]);
  });

  it('uses a partial image source window and finite destination mapping rather than fitting the full image to its visible polygon', () => {
    const entry = frameEntry(
      stroke('image', { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], src: 'memory://mapped' }),
      90,
      90,
      [resourceBox(
        'image',
        { src: 'memory://mapped' },
        { x: 500_000, y: 500_000 },
        500_000,
        500_000,
        0.4,
        { minX: 2, minY: 1, maxX: 14, maxY: 9 },
        {
          source: { x: 0.4, y: 0.2, width: 0.1, height: 0.08 },
          destination: { center: { x: 8, y: 5 }, halfWidth: 6, halfHeight: 4, rotationRad: 0.4 },
        }
      )]
    );
    const ready = {} as never;
    const descriptors = describeSkiaFrameEntries([entry], (src) => src === 'memory://mapped' ? ready : null);
    const nodes = hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} getImage={() => ready} />);
    const shader = nodes.find(({ type }) => type === 'skia-image-shader');
    const clip = nodes.find(({ type, props }) => type === 'skia-group' && props.clip !== undefined)?.props.clip as { moveTo: jest.Mock };

    expect(descriptors).toMatchObject([
      { descriptor: { kind: 'frame-image', resourceBox: { imageMapping: { source: { x: 0.4, y: 0.2, width: 0.1, height: 0.08 }, destination: { center: { x: 8, y: 5 }, halfWidth: 6, halfHeight: 4 } } } } },
    ]);
    expect(shader?.props.rect).toEqual({ x: 2, y: 1, width: 12, height: 8 });
    const transform = shader?.props.transform as readonly Record<string, number>[];
    expect(transform[0].translateX).toBeCloseTo(4.8);
    expect(transform[1].translateY).toBeCloseTo(1.6);
    expect(transform[2].scaleX).toBeCloseTo(0.1);
    expect(transform[3].scaleY).toBeCloseTo(0.08);
    expect(clip.moveTo.mock.calls[0]).toEqual([2, 1]);
    expect(nodes.filter(({ type }) => type === 'skia-image')).toHaveLength(0);
  });

  it('isolates partial and unresolved resources from frame descriptors', () => {
    const safe = frameEntry(
      stroke('text', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        text: 'safe',
      }),
      20,
      20,
      [resourceBox('text', { text: 'safe', fontSize: 12 })]
    );
    const unresolved = frameEntry(
      stroke('image', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        src: 'memory://partial',
      }),
      21,
      21,
      [semanticArea({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 })],
      'rebased'
    );
    // core 不会把 partial resource 放进 renderableEntries；这里故意伪造该状态，验证
    // Skia adapter 仍不会将非 resourceBox 的 resource area 降级为普通填充。
    const frame = frameWithEntries([safe, unresolved], undefined, true, [safe, unresolved]);

    expect(describeSkiaFrameEntries([safe, unresolved]).map(({ key }) => key)).toEqual([20]);
    expect(
      hostNodes(
        <SkiaDrawingCanvas frame={frame} fontManager={{} as never} fontFamily="Fixture Sans" />
      ).filter(({ type }) => type === 'skia-paragraph')
    ).toHaveLength(1);
  });

  it('preserves explicit zero stroke, rejects no-fill, and only fills closed world shapes', () => {
    const open = describeSkiaStroke(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        strokeWidth: 0,
        fillColor: '#ff00ff',
      })
    );
    const closed = describeSkiaStroke(
      stroke('rect', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        strokeWidth: 0,
        fillColor: 'none',
      })
    );
    const tree = (
      <SkiaDrawingCanvas
        document={{
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          strokes: [
            stroke('line', {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              strokeWidth: 0,
              fillColor: '#ff00ff',
            }),
            stroke('rect', {
              points: [
                { x: 0, y: 10 },
                { x: 10, y: 20 },
              ],
              strokeWidth: 0,
              fillColor: 'none',
            }),
          ],
        }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );

    expect(open).toMatchObject({ style: { strokeWidth: 0, fillColor: undefined } });
    expect(closed).toMatchObject({ style: { strokeWidth: 0, fillColor: undefined } });
    expect(hostNodes(tree).filter(({ type }) => type === 'skia-path')).toHaveLength(0);
  });

  it('uses core pen geometry coordinates and only attaches pressure by matching index', () => {
    const pressurePen = stroke('pen', {
      strokeWidth: 10,
      points: [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 10, y: 0, pressure: 0.2 },
        { x: 20, y: 0, pressure: 1 },
      ],
    });
    const descriptor = describeSkiaStroke(pressurePen);
    const geometry = describeDrawingStrokeGeometry(pressurePen);

    expect(descriptor).toMatchObject({
      kind: 'path',
      points: geometry?.kind === 'path' ? geometry.points : [],
    });
    expect(descriptor).toMatchObject({
      kind: 'path',
      pressureSensitive: true,
      points: [{ pressure: 0.2 }, { pressure: 0.2 }, { pressure: 1 }],
    });
  });

  it('rejects a pen when the core geometry rejects it', () => {
    expect(
      describeSkiaStroke(
        stroke('pen', {
          points: [{ x: 0, y: 0, pressure: 0.2 }],
        })
      )
    ).toBeNull();
  });

  it('makes each nonzero pressure segment observable', () => {
    const pressurePen = stroke('pen', {
      strokeWidth: 10,
      points: [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 10, y: 0, pressure: 0.2 },
        { x: 20, y: 0, pressure: 1 },
      ],
    });
    const tree = (
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [pressurePen] }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );
    const widths = hostNodes(tree)
      .filter(({ type }) => type === 'skia-path')
      .map(({ props }) => props.strokeWidth);

    expect(widths).toEqual([2, 10]);
  });

  it('normalizes pen pressure without converting zero to the normal width', () => {
    const pressurePen = stroke('pen', {
      strokeWidth: 10,
      points: [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 10, y: 0, pressure: 0 },
        { x: 20, y: 0, pressure: 0.2 },
        { x: 30, y: 0, pressure: 1 },
        { x: 40, y: 0, pressure: -1 },
        { x: 50, y: 0, pressure: 1.2 },
        { x: 60, y: 0, pressure: Infinity },
        { x: 70, y: 0 },
      ],
    });
    const tree = (
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [pressurePen] }}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
      />
    );

    expect(
      hostNodes(tree)
        .filter(({ type }) => type === 'skia-path')
        .map(({ props }) => props.strokeWidth)
    ).toEqual([2, 10, 10, 10, 10, 10]);
  });

  it('aligns dash normalization with the shared stroke style semantics', () => {
    const validZero = describeSkiaStroke(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        dashArray: [0, 5],
      })
    );
    const odd = describeSkiaStroke(
      stroke('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        dashArray: [1, 2, 3],
      })
    );
    const invalid = (
      [
        [0, 0],
        [-1, 2],
        [1, Infinity],
      ] as const
    ).map((dashArray) =>
      describeSkiaStroke(
        stroke('line', {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          dashArray: [...dashArray],
        })
      )
    );

    expect(validZero).toMatchObject({ style: { dashArray: [0, 5] } });
    expect(odd).toMatchObject({ style: { dashArray: [1, 2, 3, 1, 2, 3] } });
    expect(invalid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ style: expect.objectContaining({ dashArray: undefined }) }),
      ])
    );
    expect(invalid.every((descriptor) => descriptor?.style.dashArray === undefined)).toBe(true);
  });

  it('projects world overlays while retaining screen DIP styles, fill and dash semantics', () => {
    const overlays: readonly SkiaOverlay[] = [
      {
        id: 'world-line',
        space: 'world',
        kind: 'line',
        from: { x: 2, y: 3 },
        to: { x: 4, y: 5 },
        style: { strokeWidth: 2, dashArray: [4, 2], dashOffset: 1 },
      },
      {
        id: 'circle',
        space: 'screen',
        kind: 'circle',
        center: { x: 7, y: 9 },
        radius: 6,
        style: {
          fillColor: '#00ff00',
          fillOpacity: 0.4,
          strokeWidth: 3,
          dashArray: [3, 1],
          dashOffset: 2,
        },
      },
      {
        id: 'rect',
        space: 'screen',
        kind: 'rect',
        origin: { x: 20, y: 30 },
        width: 10,
        height: 8,
        style: { fillColor: 'none', strokeWidth: 2, dashArray: [2, 1], dashOffset: 3 },
      },
    ];
    const descriptors = describeScreenOverlays(overlays, { scale: 3, tx: 10, ty: -4 });
    const tree = (
      <SkiaDrawingCanvas
        document={{ schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [] }}
        viewport={{ scale: 3, tx: 10, ty: -4 }}
        overlays={overlays}
      />
    );
    const nodes = hostNodes(tree);
    const fills = nodes.filter(
      ({ type, props }) => type === 'skia-path' && props.skiaStyle === 'fill'
    );
    const dashes = nodes.filter(({ type }) => type === 'skia-dash');

    expect(descriptors[0]).toMatchObject({
      kind: 'line',
      from: { x: 16, y: 5 },
      to: { x: 22, y: 11 },
      style: { strokeWidth: 2, dashArray: [4, 2], dashOffset: 1 },
    });
    expect(descriptors[2]).toMatchObject({ style: { fillColor: undefined, strokeWidth: 2 } });
    expect(fills).toHaveLength(1);
    expect(fills[0]?.props).toMatchObject({ color: '#00ff00', opacity: 0.4 });
    expect(dashes.map(({ props }) => props)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ intervals: [3, 1], phase: 2 }),
        expect.objectContaining({ intervals: [2, 1], phase: 3 }),
      ])
    );
  });

  it('keeps screen descriptors viewport-invariant and only projects world overlay geometry', () => {
    const overlays: readonly SkiaOverlay[] = [
      {
        id: 'ruler-line',
        space: 'screen',
        kind: 'line',
        from: { x: 12, y: 18 },
        to: { x: 52, y: 48 },
        style: { strokeWidth: 3, dashArray: [0, 5], dashOffset: 2 },
      },
      {
        id: 'world-edge',
        space: 'world',
        kind: 'line',
        from: { x: 2, y: 3 },
        to: { x: 7, y: 11 },
        style: { strokeWidth: 4, dashArray: [3, 1], dashOffset: 6 },
      },
      {
        id: 'selection-handle',
        space: 'world',
        kind: 'circle',
        center: { x: 6, y: 8 },
        radius: 7,
        style: { strokeWidth: 2, dashArray: [2, 1], dashOffset: 4 },
      },
      {
        id: 'world-selection-box',
        space: 'world',
        kind: 'rect',
        origin: { x: 1, y: 2 },
        width: 4,
        height: 6,
        style: { strokeWidth: 1, dashArray: [1, 2], dashOffset: 3 },
      },
    ];
    const screenRulerGroup = overlays.filter((overlay) => overlay.space === 'screen');
    const screenRulerFirst = describeScreenOverlays(screenRulerGroup, { scale: 1, tx: 10, ty: -4 });
    const screenRulerSecond = describeScreenOverlays(screenRulerGroup, { scale: 2, tx: -3, ty: 5 });
    const first = describeScreenOverlays(overlays, { scale: 1, tx: 10, ty: -4 });
    const second = describeScreenOverlays(overlays, { scale: 2, tx: -3, ty: 5 });
    const rulerFirst = first[0];
    const rulerSecond = second[0];
    const worldEdge = second[1];
    const handleFirst = first[2];
    const handleSecond = second[2];
    const selectionBox = second[3];

    expect(screenRulerFirst).toEqual(screenRulerSecond);
    expect(rulerFirst).toMatchObject({
      kind: 'line',
      from: { x: 12, y: 18 },
      to: { x: 52, y: 48 },
    });
    if (rulerFirst?.kind !== 'line' || rulerSecond?.kind !== 'line') {
      throw new Error('尺子 overlay 应保持 line descriptor。');
    }
    expect({
      x: rulerFirst.to.x - rulerFirst.from.x,
      y: rulerFirst.to.y - rulerFirst.from.y,
    }).toEqual({
      x: rulerSecond.to.x - rulerSecond.from.x,
      y: rulerSecond.to.y - rulerSecond.from.y,
    });
    expect(worldEdge).toMatchObject({
      kind: 'line',
      from: { x: 1, y: 11 },
      to: { x: 11, y: 27 },
      style: { strokeWidth: 4, dashArray: [3, 1], dashOffset: 6 },
    });
    expect(selectionBox).toMatchObject({
      kind: 'polyline',
      points: [
        { x: -1, y: 9 },
        { x: 7, y: 9 },
        { x: 7, y: 21 },
        { x: -1, y: 21 },
      ],
      style: { strokeWidth: 1, dashArray: [1, 2], dashOffset: 3 },
    });
    expect(handleFirst).toMatchObject({ kind: 'circle', center: { x: 16, y: 4 }, radius: 7 });
    expect(handleSecond).toMatchObject({ kind: 'circle', center: { x: 9, y: 21 }, radius: 7 });
    expect(handleSecond).toMatchObject({
      style: { strokeWidth: 2, dashArray: [2, 1], dashOffset: 4 },
    });
  });

  it('reuses static world elements across overlay-only rerenders while redrawing overlays', () => {
    const firstStroke = stroke('line', {
      id: 'world-a',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      strokeColor: '#101010',
    });
    const secondStroke = stroke('line', {
      id: 'world-b',
      points: [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
      strokeColor: '#202020',
    });
    // 同一个 frame 对象只构造一次：这是「frame 身份稳定」的 memoization 前提。
    const frame = frameWithEntries([
      frameEntry(firstStroke, 1, 1, [strokeFragment({ x: 0, y: 0 }, { x: 10, y: 0 })]),
      frameEntry(secondStroke, 2, 2, [strokeFragment({ x: 0, y: 5 }, { x: 10, y: 5 })]),
    ]);
    const overlayA: SkiaOverlay = {
      id: 'overlay-a',
      space: 'screen',
      kind: 'line',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      style: { strokeWidth: 2, color: '#ff0000' },
    };
    const overlayB: SkiaOverlay = {
      id: 'overlay-b',
      space: 'screen',
      kind: 'line',
      from: { x: 2, y: 2 },
      to: { x: 3, y: 3 },
      style: { strokeWidth: 2, color: '#00ff00' },
    };
    const worldPaths = (nodes: ReturnType<typeof hostNodes>) =>
      nodes
        .filter(
          ({ type, props }) =>
            type === 'skia-path' &&
            props.skiaStyle === 'stroke' &&
            (props.color === '#101010' || props.color === '#202020')
        )
        .map(({ props }) => props.path);

    const firstNodes = hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[overlayA]} />);
    const firstWorldPaths = worldPaths(firstNodes);
    const firstOverlay = firstNodes.find(
      ({ type, props }) => type === 'skia-path' && props.color === '#ff0000'
    );

    const secondNodes = hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[overlayB]} />);
    const secondWorldPaths = worldPaths(secondNodes);
    const secondOverlay = secondNodes.find(
      ({ type, props }) => type === 'skia-path' && props.color === '#00ff00'
    );

    // 世界静态层命中缓存：两次 render 复用同一批 SkPath 引用，未重新分配。
    expect(firstWorldPaths).toHaveLength(2);
    expect(secondWorldPaths).toHaveLength(2);
    expect(secondWorldPaths[0]).toBe(firstWorldPaths[0]);
    expect(secondWorldPaths[1]).toBe(firstWorldPaths[1]);
    // overlay 必须仍然每次重绘：新 path 引用，且旧颜色消失、新颜色出现。
    expect(firstOverlay?.props.path).toBeDefined();
    expect(secondOverlay?.props.path).toBeDefined();
    expect(secondOverlay?.props.path).not.toBe(firstOverlay?.props.path);
    expect(firstNodes.some(({ type, props }) => type === 'skia-path' && props.color === '#ff0000')).toBe(true);
    expect(secondNodes.some(({ type, props }) => type === 'skia-path' && props.color === '#ff0000')).toBe(false);
  });

  it('invalidates static world element cache when the frame identity changes', () => {
    const lineStroke = stroke('line', {
      id: 'world-static',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      strokeColor: '#303030',
    });
    // 复用同一个 entry 对象，但每次包进新的 frame：缓存必须以 frame 身份失效，而非 entry 身份。
    const entry = frameEntry(lineStroke, 1, 1, [strokeFragment({ x: 0, y: 0 }, { x: 10, y: 0 })]);
    const worldPathOf = (nodes: ReturnType<typeof hostNodes>) =>
      nodes.find(
        ({ type, props }) =>
          type === 'skia-path' && props.skiaStyle === 'stroke' && props.color === '#303030'
      )?.props.path;

    const firstPath = worldPathOf(hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />));
    const secondPath = worldPathOf(hostNodes(<SkiaDrawingCanvas frame={frameWithEntries([entry])} />));

    expect(firstPath).toBeDefined();
    expect(secondPath).toBeDefined();
    expect(secondPath).not.toBe(firstPath);
  });

  it('re-resolves text and image resources on every render even when frame identity is stable', () => {
    const textEntry = frameEntry(
      stroke('text', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        text: 'hello',
        fontSize: 12,
      }),
      1,
      1,
      [resourceBox('text', { text: 'hello', fontSize: 12 })]
    );
    const imageEntry = frameEntry(
      stroke('image', {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        src: 'memory://late-image',
      }),
      2,
      2,
      [resourceBox('image', { src: 'memory://late-image' })]
    );
    const frame = frameWithEntries([textEntry, imageEntry]);

    // 同一 frame：第一次无同步资源 → 只出现几何回退，不出现 Paragraph/Image。
    const withoutResources = hostNodes(<SkiaDrawingCanvas frame={frame} />);
    expect(
      withoutResources.filter(({ type }) => type === 'skia-paragraph' || type === 'skia-image')
    ).toHaveLength(0);

    // 第二次同 frame，但资源已就绪：text/image 必须重新解析并渲染，证明资源条目未进入缓存。
    const withResources = hostNodes(
      <SkiaDrawingCanvas
        frame={frame}
        fontManager={{} as never}
        fontFamily="Fixture Sans"
        getImage={(src) => (src === 'memory://late-image' ? ({} as never) : null)}
      />
    );
    expect(withResources.filter(({ type }) => type === 'skia-paragraph')).toHaveLength(1);
    expect(withResources.filter(({ type }) => type === 'skia-image')).toHaveLength(1);
  });

  it('preserves static/resource interleaving order and ids on the memoized path', () => {
    const before = frameEntry(
      stroke('line', {
        id: 'before',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        strokeColor: '#0a0a0a',
      }),
      1,
      1,
      [strokeFragment({ x: 0, y: 0 }, { x: 10, y: 0 })]
    );
    const middle = frameEntry(
      stroke('text', {
        points: [
          { x: 0, y: 20 },
          { x: 20, y: 30 },
        ],
        text: 'mid',
        fontSize: 12,
      }),
      2,
      2,
      [resourceBox('text', { text: 'mid', fontSize: 12 }, { x: 10, y: 25 })]
    );
    const after = frameEntry(
      stroke('line', {
        id: 'after',
        points: [
          { x: 0, y: 40 },
          { x: 10, y: 40 },
        ],
        strokeColor: '#0b0b0b',
      }),
      3,
      3,
      [strokeFragment({ x: 0, y: 40 }, { x: 10, y: 40 })]
    );

    const nodes = hostNodes(
      <SkiaDrawingCanvas
        frame={frameWithEntries([before, middle, after])}
        fontManager={{} as never}
        fontFamily="Fixture Sans"
      />
    );
    const strokeColors = nodes
      .filter(({ type, props }) => type === 'skia-path' && props.skiaStyle === 'stroke')
      .map(({ props }) => props.color);
    const beforeIndex = nodes.findIndex(
      ({ type, props }) => type === 'skia-path' && props.color === '#0a0a0a'
    );
    const paragraphIndex = nodes.findIndex(({ type }) => type === 'skia-paragraph');
    const afterIndex = nodes.findIndex(
      ({ type, props }) => type === 'skia-path' && props.color === '#0b0b0b'
    );

    expect(strokeColors).toEqual(['#0a0a0a', '#0b0b0b']);
    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(paragraphIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(paragraphIndex);
  });

  it('renders an offscreen screen pulse overlay as a redrawable command whose geometry changes per publish', () => {
    // 诊断 pulse 契约：屏外极小 command，端点随 publish 变化，但仍在 draw budget 内可见于描述层。
    const pulse = (seed: number): SkiaOverlay => ({
      id: 'perf-renderer-pulse',
      space: 'screen',
      kind: 'line',
      from: { x: -1000, y: -1000 },
      to: { x: -1000 + (seed % 512) * 0.001, y: -1000 },
      style: { strokeWidth: 1, color: '#000000' },
    });
    const frame = frameWithEntries([]);
    const pulsePathOf = (nodes: ReturnType<typeof hostNodes>) =>
      nodes.find(
        ({ type, props }) => type === 'skia-path' && props.color === '#000000'
      )?.props.path as { moveTo: jest.Mock; lineTo: jest.Mock } | undefined;

    const firstPath = pulsePathOf(
      hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[pulse(1)]} />)
    );
    const secondPath = pulsePathOf(
      hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[pulse(2)]} />)
    );

    expect(firstPath).toBeDefined();
    expect(secondPath).toBeDefined();
    expect(firstPath?.moveTo.mock.calls[0]).toEqual([-1000, -1000]);
    expect(firstPath?.lineTo.mock.calls[0]).toEqual([-1000 + 0.001, -1000]);
    expect(secondPath?.lineTo.mock.calls[0]).toEqual([-1000 + 0.002, -1000]);
    expect(secondPath).not.toBe(firstPath);
  });

  it('keeps world static elements cached while a changed pulse overlay still forces a new command', () => {
    const worldStroke = stroke('line', {
      id: 'pulse-world',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      strokeColor: '#123456',
    });
    const frame = frameWithEntries([
      frameEntry(worldStroke, 1, 1, [strokeFragment({ x: 0, y: 0 }, { x: 10, y: 0 })]),
    ]);
    const pulse = (seed: number): SkiaOverlay => ({
      id: 'perf-renderer-pulse',
      space: 'screen',
      kind: 'line',
      from: { x: -1000, y: -1000 },
      to: { x: -1000 + (seed % 512) * 0.001, y: -1000 },
      style: { strokeWidth: 1, color: '#000000' },
    });
    const pathOfColor = (nodes: ReturnType<typeof hostNodes>, color: string) =>
      nodes.find(({ type, props }) => type === 'skia-path' && props.color === color)?.props.path;

    const first = hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[pulse(1)]} />);
    const second = hostNodes(<SkiaDrawingCanvas frame={frame} overlays={[pulse(2)]} />);

    // 世界静态层命中 frame 缓存（同一 SkPath 引用）；pulse 每次都产生新 command。
    expect(pathOfColor(first, '#123456')).toBeDefined();
    expect(pathOfColor(first, '#123456')).toBe(pathOfColor(second, '#123456'));
    expect(pathOfColor(first, '#000000')).not.toBe(pathOfColor(second, '#000000'));
  });
});
