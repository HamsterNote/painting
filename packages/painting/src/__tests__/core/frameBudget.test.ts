/** @jest-environment node */

import {
  createFrameDrawBudget,
  isDrawDash,
  isDrawNumber,
  isDrawPoint,
  isDrawResourceBox,
  isDrawStyle,
} from '../../core/internal';
import type { FrameShapedGlyphRun, FrameTextProgram } from '../../core/frameClipping';

describe('core/frameBudget', () => {
  const budget = createFrameDrawBudget(100, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })!;

  it('accepts only finite scalar, point, dash and style inputs inside the one draw budget', () => {
    expect(isDrawNumber(100, budget)).toBe(true);
    expect(isDrawNumber(100.01, budget)).toBe(false);
    expect(isDrawNumber(Number.POSITIVE_INFINITY, budget)).toBe(false);
    expect(isDrawPoint({ x: -100, y: 100 }, budget)).toBe(true);
    expect(isDrawPoint({ x: 101, y: 0 }, budget)).toBe(false);
    expect(isDrawDash([10, 20], -5, budget)).toBe(true);
    expect(isDrawDash([101], 0, budget)).toBe(false);
    expect(isDrawDash([70, 70], 0, budget)).toBe(false);
    expect(
      isDrawStyle({ strokeWidth: 5, fillOpacity: 1, dashArray: [10, 20], dashOffset: 0 }, budget)
    ).toBe(true);
    expect(isDrawStyle({ strokeWidth: 5, fillOpacity: 2, dashOffset: 0 }, budget)).toBe(false);
  });

  it('rejects a local-to-screen affine whose final translation cannot enter Skia safely', () => {
    expect(createFrameDrawBudget(100, { a: 1, b: 0, c: 0, d: 1, tx: 101, ty: 0 })).toBeNull();
    expect(
      createFrameDrawBudget(100, { a: 1, b: 0, c: 0, d: 1, tx: Number.NaN, ty: 0 })
    ).toBeNull();
  });

  it('rejects a rotated resource whose local corners are valid but scale 8 sends final screen corners over budget', () => {
    const scaled = createFrameDrawBudget(100, { a: 8, b: 0, c: 0, d: 8, tx: 0, ty: 0 })!;
    const fragment = {
      kind: 'semantic-area' as const,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      resourceBox: {
        kind: 'resource-box' as const,
        tool: 'image' as const,
        layout: {
          center: { x: 20, y: 20 },
          halfWidth: 10,
          halfHeight: 10,
          rotationRad: Math.PI / 4,
        },
        source: { src: 'memory://budget' },
      },
    };

    expect(isDrawResourceBox(fragment, scaled)).toBe(false);
  });

  it('accepts only an explicitly resolved partial text program and rejects unsafe anchors', () => {
    const partialText = (textProgram?: FrameTextProgram) => ({
      kind: 'semantic-area' as const,
      points: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
        { x: -10, y: 5 },
      ],
      resourceBox: {
        kind: 'resource-box' as const,
        tool: 'text' as const,
        // 审计 layout 故意超预算：它不是 partial Paragraph 的 Skia 输入。
        layout: { center: { x: 0, y: 0 }, halfWidth: 1_000, halfHeight: 5, rotationRad: 0.2 },
        visible: {
          clipBounds: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
          polygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
            { x: -10, y: 5 },
          ],
        },
        textRequest: {
          revision: 'text',
          text: 'finite',
          fontSize: 12,
          paragraphOrigin: { x: -10, y: -5 },
          paragraphWidth: 72,
          paragraphLayoutWidth: 72,
          paragraphDirection: 'auto' as const,
          paragraphAlignment: 'start' as const,
          rotationRad: 0.2,
          visiblePolygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
        ...(textProgram === undefined ? {} : { textProgram }),
        source: { text: 'finite', fontSize: 12 },
      },
    });

    const readyRun = {
      glyphs: new Uint16Array([1]),
      positions: new Float32Array([0, 0]),
      typeface: {},
      font: {},
      fontReady: true,
      size: 12,
      scaleX: 1,
    };
    expect(
      isDrawResourceBox(
        partialText({
          kind: 'shaped-runs',
          anchor: { x: 0, y: 0 },
          rotationRad: 0,
          runs: [readyRun],
          semanticRegions: [
            {
              polygon: [
                { x: -10, y: -5 },
                { x: 10, y: -5 },
                { x: 10, y: 5 },
              ],
            },
          ],
        }),
        budget
      )
    ).toBe(true);
    expect(isDrawResourceBox(partialText(), budget)).toBe(false);
    expect(
      isDrawResourceBox(
        partialText({
          kind: 'shaped-runs',
          anchor: { x: 101, y: 0 },
          rotationRad: 0,
          runs: [readyRun],
          semanticRegions: [
            {
              polygon: [
                { x: -10, y: -5 },
                { x: 10, y: -5 },
                { x: 10, y: 5 },
              ],
            },
          ],
        }),
        budget
      )
    ).toBe(false);
  });

  it('rejects shaped runs before render when preflight, font scale, or final rotated glyph position is unsafe', () => {
    const readyRun = {
      glyphs: new Uint16Array([1]),
      positions: new Float32Array([20, 0]),
      typeface: {},
      font: {},
      fontReady: true,
      size: 12,
      scaleX: 1,
    };
    const partialText = (textProgram: FrameTextProgram) => ({
      kind: 'semantic-area' as const,
      points: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
      ],
      resourceBox: {
        kind: 'resource-box' as const,
        tool: 'text' as const,
        layout: { center: { x: 0, y: 0 }, halfWidth: 1_000, halfHeight: 5, rotationRad: 0 },
        visible: {
          clipBounds: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
          polygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
        textRequest: {
          revision: 'text',
          text: 'finite',
          fontSize: 12,
          paragraphOrigin: { x: -10, y: -5 },
          paragraphWidth: 72,
          paragraphLayoutWidth: 72,
          paragraphDirection: 'auto' as const,
          paragraphAlignment: 'start' as const,
          rotationRad: 0,
          visiblePolygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
        textProgram,
        source: { text: 'finite', fontSize: 12 },
      },
    });
    const program = (run: typeof readyRun): FrameTextProgram => ({
      kind: 'shaped-runs',
      anchor: { x: 90, y: 0 },
      rotationRad: 0,
      runs: [run],
      semanticRegions: [
        {
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    });

    expect(
      isDrawResourceBox(
        partialText({
          kind: 'shaped-runs',
          anchor: { x: 0, y: 0 },
          rotationRad: 0,
          runs: [{ ...readyRun, fontReady: false }],
          semanticRegions: [
            {
              polygon: [
                { x: -10, y: -5 },
                { x: 10, y: -5 },
                { x: 10, y: 5 },
              ],
            },
          ],
        }),
        budget
      )
    ).toBe(false);
    expect(isDrawResourceBox(partialText(program({ ...readyRun, scaleX: 101 })), budget)).toBe(
      false
    );
    expect(isDrawResourceBox(partialText(program(readyRun)), budget)).toBe(false);
  });

  it('requires both fontReady and a non-null opaque font handle before a shaped run enters render/hit', () => {
    const partialText = (textProgram: FrameTextProgram) => ({
      kind: 'semantic-area' as const,
      points: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
      ],
      resourceBox: {
        kind: 'resource-box' as const,
        tool: 'text' as const,
        layout: { center: { x: 0, y: 0 }, halfWidth: 1_000, halfHeight: 5, rotationRad: 0 },
        visible: {
          clipBounds: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
          polygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
        textRequest: {
          revision: 'text',
          text: 'finite',
          fontSize: 12,
          paragraphOrigin: { x: -10, y: -5 },
          paragraphWidth: 72,
          paragraphLayoutWidth: 72,
          paragraphDirection: 'auto' as const,
          paragraphAlignment: 'start' as const,
          rotationRad: 0,
          visiblePolygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
        textProgram,
        source: { text: 'finite', fontSize: 12 },
      },
    });
    // font handle 为 opaque 平台对象；null/undefined 必须与 fontReady 一起被预算拒绝。
    const readyRun: FrameShapedGlyphRun = {
      glyphs: new Uint16Array([1]),
      positions: new Float32Array([0, 0]),
      typeface: {},
      font: {},
      fontReady: true,
      size: 12,
      scaleX: 1,
    };
    const shaped = (run: FrameShapedGlyphRun): FrameTextProgram => ({
      kind: 'shaped-runs',
      anchor: { x: 0, y: 0 },
      rotationRad: 0,
      runs: [run],
      semanticRegions: [
        {
          polygon: [
            { x: -10, y: -5 },
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
      ],
    });

    // fontReady:false 的既有拒绝语义不被削弱。
    expect(isDrawResourceBox(partialText(shaped({ ...readyRun, fontReady: false })), budget)).toBe(
      false
    );
    // fontReady:true 但 font 缺失（null / undefined）同样必须拒绝，不能仅信 fontReady。
    expect(isDrawResourceBox(partialText(shaped({ ...readyRun, font: null })), budget)).toBe(false);
    expect(isDrawResourceBox(partialText(shaped({ ...readyRun, font: undefined })), budget)).toBe(
      false
    );
    // 有效的 ready handle 照常通过。
    expect(isDrawResourceBox(partialText(shaped(readyRun)), budget)).toBe(true);
  });
});
