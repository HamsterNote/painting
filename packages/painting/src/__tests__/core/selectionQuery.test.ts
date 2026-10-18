/** @jest-environment node */

import {
  queryDrawingFrameEraserTargets,
  queryDrawingFrameLassoTargets,
  queryEraserStrokeTargets,
  queryLassoStrokeTargets,
} from '../../core/selectionQuery';
import { createDrawingFrame, createPreparedDrawingSpatialIndex } from '../../core/drawingFrame';
import { prepareDrawingDocument } from '../../core/preparedDocument';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

type Point = { x: number; y: number };

function stroke<T extends DrawingStrokeV2['tool']>(
  tool: T,
  id: string,
  points: Point[]
): Extract<DrawingStrokeV2, { tool: T }> {
  return { schemaVersion: 2, id, tool, points } as Extract<DrawingStrokeV2, { tool: T }>;
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

const square = (minX: number, minY: number, maxX: number, maxY: number): Point[] => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
];

function frameFor(
  strokes: DrawingStrokeV2[],
  viewport = { scale: 1, tx: 0, ty: 0 },
  resolveTextProgram?: Parameters<typeof createDrawingFrame>[0]['resolveTextProgram']
) {
  const prepared = prepareDrawingDocument(documentWith(...strokes));
  return createDrawingFrame({
    prepared,
    spatialIndex: createPreparedDrawingSpatialIndex(prepared),
    viewport,
    layoutSize: { width: 100, height: 100 },
    ...(resolveTextProgram ? { resolveTextProgram } : {}),
  })!;
}

describe('core/selectionQuery', () => {
  it('returns every V2 tool in stable document-index order', () => {
    const document = documentWith(
      stroke('pen', 'pen', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
      stroke('line', 'line', [
        { x: 1, y: 0 },
        { x: 2, y: 1 },
      ]),
      stroke('rect', 'rect', [
        { x: 2, y: 0 },
        { x: 3, y: 1 },
      ]),
      stroke('ellipse', 'ellipse', [
        { x: 3, y: 0 },
        { x: 4, y: 1 },
      ]),
      stroke('polygon', 'polygon', [
        { x: 4, y: 0 },
        { x: 5, y: 0 },
        { x: 4.5, y: 1 },
      ]),
      stroke('bezier', 'bezier', [
        { x: 5, y: 0 },
        { x: 5, y: 1 },
        { x: 6, y: 0 },
        { x: 6, y: 1 },
      ]),
      {
        ...stroke('text', 'text', [
          { x: 6, y: 0 },
          { x: 7, y: 1 },
        ]),
        text: 'x',
        fontSize: 12,
      },
      {
        ...stroke('image', 'image', [
          { x: 7, y: 0 },
          { x: 8, y: 1 },
        ]),
        src: 'memory://image',
      }
    );

    const result = queryLassoStrokeTargets(document, square(-1, -1, 9, 2));

    expect(result.targets.map(({ index, stroke: value }) => [index, value.id])).toEqual([
      [0, 'pen'],
      [1, 'line'],
      [2, 'rect'],
      [3, 'ellipse'],
      [4, 'polygon'],
      [5, 'bezier'],
      [6, 'text'],
      [7, 'image'],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps duplicate IDs distinct and ordered by document index', () => {
    const first = stroke('line', 'duplicate', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const second = stroke('line', 'between', [
      { x: 0, y: 1 },
      { x: 10, y: 1 },
    ]);
    const third = stroke('line', 'duplicate', [
      { x: 0, y: 2 },
      { x: 10, y: 2 },
    ]);
    const document = documentWith(first, second, third);

    expect(
      queryEraserStrokeTargets(
        document,
        [
          { x: 5, y: -1 },
          { x: 5, y: 3 },
        ],
        0
      ).targets
    ).toEqual([
      { index: 0, stroke: first },
      { index: 1, stroke: second },
      { index: 2, stroke: third },
    ]);
    expect(
      queryEraserStrokeTargets(
        document,
        [
          { x: 5, y: -1 },
          { x: 5, y: 3 },
        ],
        0,
        { topmostOnly: true }
      ).targets
    ).toEqual([{ index: 2, stroke: third }]);
  });

  it('matches lasso containment, boundary intersection, and object containment without selecting external objects', () => {
    const inside = stroke('rect', 'inside', [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    const crossing = stroke('line', 'crossing', [
      { x: -1, y: 5 },
      { x: 5, y: 5 },
    ]);
    const enclosing = stroke('rect', 'enclosing', [
      { x: -2, y: -2 },
      { x: 12, y: 12 },
    ]);
    const outside = stroke('rect', 'outside', [
      { x: 20, y: 20 },
      { x: 21, y: 21 },
    ]);

    expect(
      queryLassoStrokeTargets(
        documentWith(inside, crossing, enclosing, outside),
        square(0, 0, 10, 10)
      ).targets
    ).toEqual([
      { index: 0, stroke: inside },
      { index: 1, stroke: crossing },
      { index: 2, stroke: enclosing },
    ]);
  });

  it('safely rejects invalid lasso inputs and reports unsupported degenerate geometry', () => {
    const degenerate = stroke('line', 'degenerate', [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);
    const document = documentWith(degenerate);

    expect(
      queryLassoStrokeTargets(document, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toEqual({
      targets: [],
      diagnostics: [{ type: 'invalid-lasso-polygon' }],
    });
    expect(queryLassoStrokeTargets(document, square(0, 0, 2, 2))).toEqual({
      targets: [],
      diagnostics: [{ type: 'unsupported-stroke-geometry', index: 0 }],
    });
  });

  it('skips a runtime-unknown tool with an explicit diagnostic', () => {
    const unknownTool = {
      schemaVersion: 2,
      id: 'unknown',
      tool: 'legacy-tool',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    } as unknown as DrawingStrokeV2;

    expect(queryLassoStrokeTargets(documentWith(unknownTool), square(-1, -1, 2, 2))).toEqual({
      targets: [],
      diagnostics: [{ type: 'unsupported-stroke-tool', index: 0 }],
    });
  });

  it('sweeps eraser samples continuously, deduplicates stroke hits, and observes radius', () => {
    const crossed = stroke('line', 'crossed', [
      { x: 5, y: 0 },
      { x: 5, y: 10 },
    ]);
    const near = stroke('line', 'near', [
      { x: 5, y: 12 },
      { x: 6, y: 12 },
    ]);
    const document = documentWith(crossed, near);

    expect(
      queryEraserStrokeTargets(
        document,
        [
          { x: 0, y: 5 },
          { x: 10, y: 5 },
        ],
        0
      ).targets
    ).toEqual([{ index: 0, stroke: crossed }]);
    expect(
      queryEraserStrokeTargets(
        document,
        [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
        2
      ).targets
    ).toEqual([
      { index: 0, stroke: crossed },
      { index: 1, stroke: near },
    ]);
  });

  it('safely rejects invalid eraser samples and radius', () => {
    const document = documentWith(
      stroke('line', 'line', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    );

    expect(queryEraserStrokeTargets(document, [], 2)).toEqual({
      targets: [],
      diagnostics: [{ type: 'invalid-eraser-samples' }],
    });
    expect(queryEraserStrokeTargets(document, [{ x: Number.NaN, y: 0 }], 2)).toEqual({
      targets: [],
      diagnostics: [{ type: 'invalid-eraser-samples' }],
    });
    expect(queryEraserStrokeTargets(document, [{ x: 0, y: 0 }], -1)).toEqual({
      targets: [],
      diagnostics: [{ type: 'invalid-eraser-radius' }],
    });
  });

  it('does not mutate either document or caller-owned query points', () => {
    const document = documentWith(
      stroke('rect', 'rect', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    );
    const lasso = square(-1, -1, 11, 11);
    const samples = [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ];
    const beforeDocument = JSON.parse(JSON.stringify(document));
    const beforeLasso = JSON.parse(JSON.stringify(lasso));
    const beforeSamples = JSON.parse(JSON.stringify(samples));

    queryLassoStrokeTargets(document, lasso);
    queryEraserStrokeTargets(document, samples, 1);

    expect(document).toEqual(beforeDocument);
    expect(lasso).toEqual(beforeLasso);
    expect(samples).toEqual(beforeSamples);
  });

  it('queries only renderable frame programs in stable index order, including compound nonzero fills', () => {
    const compound = {
      ...stroke('polygon', 'compound', [
        { x: -1_000, y: -1_000 },
        { x: 1_000, y: -1_000 },
        { x: 1_000, y: 1_000 },
        { x: -1_000, y: 1_000 },
        { x: -1_000, y: 600 },
        { x: 600, y: 600 },
        { x: 600, y: 400 },
        { x: -1_000, y: 400 },
      ]),
      fillColor: '#000',
      strokeWidth: 0,
    };
    const duplicate = stroke('line', 'compound', [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
    ]);
    const frame = frameFor([compound, duplicate]);

    expect(
      queryDrawingFrameLassoTargets(frame, square(45, 45, 55, 55), {
        frameRevision: 7,
        expectedRevision: 7,
      })
    ).toEqual({
      targets: [{ index: 0, id: 'compound', tool: 'polygon' }],
      diagnostics: [],
    });
    expect(
      queryDrawingFrameEraserTargets(
        frame,
        [
          { x: 50, y: 0 },
          { x: 50, y: 20 },
        ],
        0,
        {
          frameRevision: 7,
          expectedRevision: 7,
          topmostOnly: true,
        }
      ).targets
    ).toEqual([{ index: 1, id: 'compound', tool: 'line' }]);
  });

  it('uses clipped/rebased program coordinates for partial curves and screen samples at huge world coordinates', () => {
    const global = 1_000_000_000.125;
    const cubic = stroke('bezier', 'cubic', [
      { x: global - 200, y: global + 50 },
      { x: global - 100, y: global - 200 },
      { x: global + 100, y: global + 300 },
      { x: global + 200, y: global + 50 },
    ]);
    const ellipse = {
      ...stroke('ellipse', 'ellipse', [
        { x: global - 180, y: global - 120 },
        { x: global + 180, y: global + 120 },
      ]),
      rotationRad: Math.PI / 5,
    };
    const frame = frameFor([cubic, ellipse], { scale: 1, tx: -global, ty: -(global + 50) });

    expect(frame.renderableEntries.map((entry) => entry.source.stroke.id)).toEqual([
      'cubic',
      'ellipse',
    ]);
    expect(
      queryDrawingFrameLassoTargets(frame, square(-2, -2, 2, 2), {
        frameRevision: 2,
        expectedRevision: 2,
        coordinateSpace: 'screen',
      }).targets
    ).toEqual([
      { index: 0, id: 'cubic', tool: 'bezier' },
      { index: 1, id: 'ellipse', tool: 'ellipse' },
    ]);
    expect(
      queryDrawingFrameEraserTargets(
        frame,
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        1,
        {
          frameRevision: 2,
          expectedRevision: 2,
          coordinateSpace: 'screen',
        }
      ).targets
    ).toContainEqual({ index: 0, id: 'cubic', tool: 'bezier' });
  });

  it('queries bounded partial cubic and ellipse programs beyond the legacy contour cap', () => {
    const radius = 250_000_000;
    const cubic = stroke('bezier', 'capped-cubic', [
      { x: -radius, y: 0 },
      { x: -radius, y: radius },
      { x: radius, y: -radius },
      { x: radius, y: 0 },
    ]);
    const ellipse = stroke('ellipse', 'capped-ellipse', [
      { x: -radius, y: -radius },
      { x: radius, y: radius },
    ]);
    const cubicFrame = frameFor([cubic]);
    const ellipseFrame = frameFor([ellipse], { scale: 1, tx: -(radius - 50), ty: 0 });

    expect(cubicFrame.renderableEntries[0].program.maxDeviation).toBeLessThanOrEqual(0.25);
    expect(ellipseFrame.renderableEntries[0].program.maxDeviation).toBeLessThanOrEqual(0.25);
    expect(
      queryDrawingFrameLassoTargets(cubicFrame, square(-2, -2, 2, 2), {
        frameRevision: 3,
        expectedRevision: 3,
      }).targets
    ).toEqual([{ index: 0, id: 'capped-cubic', tool: 'bezier' }]);
    expect(
      queryDrawingFrameLassoTargets(ellipseFrame, square(48, -2, 52, 2), {
        frameRevision: 3,
        expectedRevision: 3,
        coordinateSpace: 'screen',
      }).targets
    ).toEqual([{ index: 0, id: 'capped-ellipse', tool: 'ellipse' }]);
  });

  it('uses text semantic regions and excludes pending, unresolved, and culled entries', () => {
    const pending = {
      ...stroke('text', 'pending', [
        { x: -2_000_000, y: 0 },
        { x: 2_000_000, y: 100 },
      ]),
      text: 'pending',
      fontSize: 12,
    };
    const unsafe = stroke('line', 'unsafe', [
      { x: 2 ** 53, y: 0 },
      { x: 2 ** 53 + 2, y: 0 },
    ]);
    const culled = stroke('line', 'culled', [
      { x: 500, y: 0 },
      { x: 600, y: 0 },
    ]);
    const pendingFrame = frameFor([pending]);
    const unsafeFrame = frameFor([unsafe], { scale: 1, tx: -(2 ** 53), ty: 0 });
    const culledFrame = frameFor([culled]);
    const resolvedText = frameFor(
      [
        {
          ...stroke('text', 'text', [
            { x: -2_000_000, y: 0 },
            { x: 2_000_000, y: 100 },
          ]),
          text: 'semantic',
          fontSize: 12,
        },
      ],
      { scale: 1, tx: 0, ty: 0 },
      (request) => ({
        kind: 'shaped-runs',
        anchor: { x: 0, y: 0 },
        rotationRad: request.rotationRad,
        runs: [
          {
            glyphs: new Uint16Array([1]),
            positions: new Float32Array([0, 0]),
            typeface: {},
            font: {},
            fontReady: true,
            size: 12,
            scaleX: 1,
          },
        ],
        semanticRegions: [{ polygon: request.visiblePolygon }],
      })
    );

    expect(pendingFrame.renderableEntries).toEqual([]);
    expect(unsafeFrame.renderableEntries).toEqual([]);
    expect(culledFrame.renderableEntries).toEqual([]);
    for (const frame of [pendingFrame, unsafeFrame, culledFrame]) {
      expect(
        queryDrawingFrameLassoTargets(frame, square(0, 0, 100, 100), {
          frameRevision: 1,
          expectedRevision: 1,
        }).targets
      ).toEqual([]);
      expect(
        queryDrawingFrameEraserTargets(
          frame,
          [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
          1,
          { frameRevision: 1, expectedRevision: 1 }
        ).targets
      ).toEqual([]);
    }
    expect(
      queryDrawingFrameLassoTargets(resolvedText, square(40, 40, 60, 60), {
        frameRevision: 1,
        expectedRevision: 1,
      }).targets
    ).toEqual([{ index: 0, id: 'text', tool: 'text' }]);
  });

  it('returns no targets for stale or invalid frame revision without inspecting another document', () => {
    const frame = frameFor([
      stroke('line', 'line', [
        { x: 0, y: 0 },
        { x: 99, y: 99 },
      ]),
    ]);

    expect(
      queryDrawingFrameLassoTargets(frame, square(0, 0, 100, 100), {
        frameRevision: 1,
        expectedRevision: 2,
      })
    ).toEqual({
      targets: [],
      diagnostics: [{ type: 'frame-revision-mismatch', frameRevision: 1, expectedRevision: 2 }],
    });
    expect(
      queryDrawingFrameEraserTargets(frame, [{ x: 0, y: 0 }], 1, {
        frameRevision: -1,
        expectedRevision: 0,
      })
    ).toEqual({
      targets: [],
      diagnostics: [{ type: 'invalid-frame-query-revision' }],
    });
  });
});
