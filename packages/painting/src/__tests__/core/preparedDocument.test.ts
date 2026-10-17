/** @jest-environment node */

import {
  appendPreparedDrawingStroke,
  prepareDrawingDocument,
  type DrawingStrokeV2,
  type DrawingValueV2,
} from '../../core/internal';

function stroke<T extends DrawingStrokeV2['tool']>(
  tool: T,
  points: Array<{ x: number; y: number; pressure?: number }>,
  id = tool
): Extract<DrawingStrokeV2, { tool: T }> {
  return { schemaVersion: 2, id, tool, points } as Extract<DrawingStrokeV2, { tool: T }>;
}

describe('core/preparedDocument', () => {
  it('prepares all eight geometry types in document order, retaining duplicate IDs', () => {
    const strokes: DrawingStrokeV2[] = [
      stroke(
        'pen',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        'duplicate'
      ),
      stroke(
        'line',
        [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        'line'
      ),
      stroke(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        'rect'
      ),
      stroke(
        'ellipse',
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        'ellipse'
      ),
      stroke(
        'polygon',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        'polygon'
      ),
      stroke(
        'bezier',
        [
          { x: 0, y: 0 },
          { x: 2, y: 4 },
          { x: 8, y: 4 },
          { x: 10, y: 0 },
        ],
        'bezier'
      ),
      {
        ...stroke(
          'text',
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          'text'
        ),
        text: 'x',
        fontSize: 12,
      },
      {
        ...stroke(
          'image',
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          'duplicate'
        ),
        src: 'image',
      },
    ];
    const result = prepareDrawingDocument({ schemaVersion: 2, strokes });

    expect(result.entries.map(({ key, order, stroke: value }) => [key, order, value.id])).toEqual([
      [0, 0, 'duplicate'],
      [1, 1, 'line'],
      [2, 2, 'rect'],
      [3, 3, 'ellipse'],
      [4, 4, 'polygon'],
      [5, 5, 'bezier'],
      [6, 6, 'text'],
      [7, 7, 'duplicate'],
    ]);
    expect(result.entries.map(({ geometry }) => geometry.kind)).toEqual([
      'path',
      'path',
      'rect',
      'ellipse',
      'path',
      'cubic-bezier',
      'rect',
      'rect',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('excludes null geometry with its document index diagnostic and freezes an independent snapshot', () => {
    const document: DrawingValueV2 = {
      schemaVersion: 2,
      strokes: [
        stroke('pen', [{ x: 0, y: 0 }]),
        stroke(
          'line',
          [
            { x: 1, y: 1 },
            { x: 4, y: 1 },
          ],
          'kept'
        ),
      ],
    };
    const prepared = prepareDrawingDocument(document);
    document.strokes[1].points[0].x = 99;

    expect(prepared.diagnostics).toEqual([{ type: 'invalid-geometry', index: 0 }]);
    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0]).toMatchObject({ key: 1, order: 1, stroke: { id: 'kept' } });
    expect(prepared.entries[0].stroke.points[0].x).toBe(1);
    expect(Object.isFrozen(prepared.entries[0].geometry)).toBe(true);
    expect(Object.isFrozen(prepared.entries[0].stroke.points)).toBe(true);
  });

  it('uses a single-loop bounds reduction for giant point lists and includes maximum stroke half width', () => {
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < 100_000; index += 1) points.push({ x: index, y: index % 7 });
    const prepared = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [stroke('pen', points, 'large')],
    });

    expect(prepared.entries[0].bounds).toEqual({ minX: -1, minY: -1, maxX: 100_000, maxY: 7 });
  });

  it('keeps rotated boxes, text/image rectangles, cubic control hulls, and pressure pens conservative', () => {
    const prepared = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [
        {
          ...stroke('rect', [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ]),
          rotationRad: Math.PI / 2,
          strokeWidth: 4,
        },
        {
          ...stroke('text', [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ]),
          text: 'x',
          fontSize: 12,
          rotationRad: Math.PI / 2,
        },
        {
          ...stroke('image', [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ]),
          src: 'image',
          rotationRad: Math.PI / 2,
        },
        stroke('bezier', [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
          { x: -100, y: -80 },
          { x: 1, y: 1 },
        ]),
        {
          ...stroke('pen', [
            { x: 0, y: 0, pressure: 0.1 },
            { x: 10, y: 0, pressure: 1 },
          ]),
          strokeWidth: 10,
        },
      ],
    });

    expect(prepared.entries[0].bounds).toMatchObject({ minX: 3, maxX: 17, minY: -7, maxY: 17 });
    expect(prepared.entries[1].bounds).toMatchObject({ minX: 4, maxX: 16, minY: -6, maxY: 16 });
    expect(prepared.entries[2].bounds).toMatchObject({ minX: 4, maxX: 16, minY: -6, maxY: 16 });
    expect(prepared.entries[3].bounds).toMatchObject({
      minX: -101,
      maxX: 101,
      minY: -81,
      maxY: 81,
    });
    expect(prepared.entries[4].bounds).toEqual({ minX: -5, minY: -5, maxX: 15, maxY: 5 });
  });

  it('appends one stroke by sharing existing frozen entries and using the next document index', () => {
    const initial = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [
        stroke(
          'pen',
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          'duplicate'
        ),
      ],
    });
    const before = JSON.stringify(initial);
    // 重复 id 合法：key/order 由 document 下标决定，绝不用 id。
    const external = stroke(
      'line',
      [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
      'duplicate'
    );
    const appended = appendPreparedDrawingStroke(initial, external);

    // 旧 snapshot 完全不变，新 snapshot 是新的冻结对象。
    expect(JSON.stringify(initial)).toBe(before);
    expect(appended).not.toBe(initial);
    expect(appended.revision).not.toBe(initial.revision);
    expect(appended.strokeCount).toBe(2);
    expect(appended.entries).toHaveLength(2);
    // 既有 entry 引用被完整复用，只有新条目被创建。
    expect(appended.entries[0]).toBe(initial.entries[0]);
    expect(appended.entries[1]).toMatchObject({
      key: 1,
      order: 1,
      stroke: { id: 'duplicate', tool: 'line' },
    });
    expect(Object.isFrozen(appended.entries)).toBe(true);
    expect(Object.isFrozen(appended.entries[1])).toBe(true);
    expect(Object.isFrozen(appended.entries[1].stroke)).toBe(true);
    expect(Object.isFrozen(appended.entries[1].stroke.points)).toBe(true);
    expect(Object.isFrozen(appended.entries[1].geometry)).toBe(true);

    // 新条目深拷贝并冻结，外部可变输入无法回写。
    external.points[0].x = 999;
    external.points.push({ x: 1, y: 1 });
    expect(appended.entries[1].stroke.points).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('records invalid append diagnostics at the true document index without replacing entries', () => {
    const initial = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [stroke('pen', [{ x: 0, y: 0 }], 'degenerate')],
    });
    expect(initial.diagnostics).toEqual([{ type: 'invalid-geometry', index: 0 }]);
    expect(initial.entries).toEqual([]);

    const appended = appendPreparedDrawingStroke(
      initial,
      stroke(
        'line',
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        'kept'
      )
    );
    expect(appended.strokeCount).toBe(2);
    expect(appended.entries).toHaveLength(1);
    expect(appended.entries[0]).toMatchObject({ key: 1, order: 1, stroke: { id: 'kept' } });
    expect(appended.diagnostics).toEqual([{ type: 'invalid-geometry', index: 0 }]);

    const invalidAgain = appendPreparedDrawingStroke(
      appended,
      stroke('pen', [{ x: 5, y: 5 }], 'degenerate-2')
    );
    expect(invalidAgain.strokeCount).toBe(3);
    // 几何无效时不创建新数组，直接复用 previous.entries 引用。
    expect(invalidAgain.entries).toBe(appended.entries);
    expect(invalidAgain.diagnostics).toEqual([
      { type: 'invalid-geometry', index: 0 },
      { type: 'invalid-geometry', index: 2 },
    ]);
  });

  it('matches a full rebuild after incremental appends, including duplicate ids and invalid geometry', () => {
    const strokes: DrawingStrokeV2[] = [
      stroke(
        'pen',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        'dup'
      ),
      stroke('pen', [{ x: 0, y: 0 }], 'dup'),
      stroke(
        'line',
        [
          { x: 5, y: 5 },
          { x: 8, y: 5 },
        ],
        'dup'
      ),
      stroke(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
        ],
        'dup'
      ),
      stroke(
        'image',
        [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
        ],
        'dup'
      ),
    ];
    let incremental = prepareDrawingDocument({ schemaVersion: 2, strokes: [] });
    for (const item of strokes) incremental = appendPreparedDrawingStroke(incremental, item);
    const full = prepareDrawingDocument({ schemaVersion: 2, strokes });

    expect(incremental.strokeCount).toBe(full.strokeCount);
    expect(incremental.entries).toEqual(full.entries);
    expect(incremental.diagnostics).toEqual(full.diagnostics);
    expect(incremental.entries.map(({ key }) => key)).toEqual(full.entries.map(({ key }) => key));
  });
});
