/** @jest-environment node */

import type { FrameTextRequest } from '../../core/frameClipping';
import { WebShapedRunProvider, canUseParagraphWindow } from '../../skia/shapedRunProvider.web';

const request: FrameTextRequest = {
  revision: 'abc', text: 'abc', fontSize: 12, paragraphOrigin: { x: 4, y: 8 }, paragraphWidth: 500, paragraphLayoutWidth: 500, paragraphDirection: 'auto', paragraphAlignment: 'start',
  rotationRad: 0, visiblePolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }],
};

describe('skia/shapedRunProvider.web', () => {
  const typeface = () => ({ getGlyphIDs: jest.fn(() => new Uint16Array([1])) });

  it('copies CanvasKit line.runs into revision cache, drops position tails, and exposes a bounded run continuation', () => {
    const firstTypeface = typeface();
    const secondTypeface = typeface();
    const makeParagraph = jest.fn(() => ({ ref: {
      getShapedLines: () => [
        { runs: [{ glyphs: new Uint16Array([10]), positions: new Float32Array([3, 4, 9, 4]), offsets: new Uint32Array([0, 1]), typeface: firstTypeface, size: 12, scaleX: 1 }] },
        { runs: [{ glyphs: new Uint16Array([11]), positions: new Float32Array([5, 6, 11, 6]), offsets: new Uint32Array([1, 2]), typeface: secondTypeface, size: 14, scaleX: 0.8 }] },
      ],
    } }));
    const provider = new WebShapedRunProvider(makeParagraph, jest.fn(() => ({ setScaleX: jest.fn() })));
    const first = provider.prepare(request, provider.continuation(request, 0, 1));
    const second = provider.prepare(request, provider.continuation(request, first.state === 'pending' ? first.cursor : 0, 1));

    expect(first).toEqual({ state: 'pending', cursor: 1 });
    expect(second).toMatchObject({ state: 'ready', program: { kind: 'shaped-runs', anchor: { x: 200 / 3, y: 10 }, runs: [{ glyphs: new Uint16Array([10]), positions: new Float32Array([-179 / 3, 2]), offsets: new Uint32Array([0, 1]), size: 12, scaleX: 1 }, { glyphs: new Uint16Array([11]), positions: new Float32Array([-173 / 3, 4]), size: 14, scaleX: 0.8 }] } });
    if (second.state !== 'ready' || second.program.kind !== 'shaped-runs') throw new Error('应得到已解析 shaped runs。');
    expect(second.program.runs[0].typeface).toMatchObject({ __typename__: 'Typeface', ref: firstTypeface });
    expect(second.program.runs[0].typeface).not.toBe(firstTypeface);
    expect(second.program.semanticRegions).not.toEqual([{ polygon: request.visiblePolygon }]);
    expect(makeParagraph).toHaveBeenCalledTimes(1);
    expect(provider.getCached(request)).toMatchObject({ kind: 'shaped-runs', anchor: { x: 200 / 3, y: 10 } });
  });

  it('keeps RTL UTF-8 offsets opaque rather than using them as substring offsets', () => {
    const rawTypeface = typeface();
    const provider = new WebShapedRunProvider(() => ({
      getShapedLines: () => [{ runs: [{ glyphIDs: new Uint16Array([42, 41]), positions: new Float32Array([20, 0, 10, 0, 0, 0]), offsets: new Uint32Array([8, 4, 0]), typeface: rawTypeface, size: 12, scaleX: 1 }] }],
    }), () => ({ setScaleX: jest.fn() }));
    const result = provider.prepare({ ...request, revision: 'rtl', text: 'مرح' });

    expect(result).toMatchObject({ state: 'ready', program: { runs: [{ offsets: new Uint32Array([8, 4, 0]) }] } });
  });

  it('accepts CJK, Arabic and emoji only when their actual run typefaces are supplied', () => {
    for (const text of ['中文', 'العربية', 'emoji 😀']) {
      const provider = new WebShapedRunProvider(() => ({ getShapedLines: () => [{ runs: [{
        glyphs: new Uint16Array([1]), positions: new Float32Array([3, 4, 12, 4]), offsets: new Uint32Array([0, 1]), typeface: typeface(), size: 12, scaleX: 1,
      }] }] }), () => ({ setScaleX: jest.fn() }));
      expect(provider.prepare({ ...request, revision: text, text })).toMatchObject({ state: 'ready', program: { kind: 'shaped-runs' } });
    }
  });

  it('does not pretend support when paragraph shaping capability or run data is absent', () => {
    expect(new WebShapedRunProvider(() => ({}), () => ({ setScaleX: jest.fn() })).prepare(request)).toEqual({ state: 'unsupported', reason: 'missing-capability' });
    const invalid = new WebShapedRunProvider(() => ({
      getShapedLines: () => [{ runs: [{ glyphs: new Uint16Array([1]), positions: new Float32Array([0, 0]), offsets: new Uint32Array([0, 1]), typeface: typeface(), size: 12, scaleX: 1 }] }],
    }), () => ({ setScaleX: jest.fn() }));
    expect(invalid.prepare(request)).toEqual({ state: 'unsupported', reason: 'invalid-shaped-lines' });
    expect(new WebShapedRunProvider(() => null, () => ({ setScaleX: jest.fn() })).prepare({ ...request, text: '' })).toEqual({ state: 'ready', program: { kind: 'empty-text' } });
  });

  it('permits paragraph window only after line metrics prove original-width no-wrap start alignment', () => {
    expect(canUseParagraphWindow(request, { getLineMetrics: () => [{ width: 400, left: 0 }] })).toBe(true);
    expect(canUseParagraphWindow(request, { getLineMetrics: () => [{ width: 400, left: 3 }] })).toBe(false);
    expect(canUseParagraphWindow(request, { getLineMetrics: () => [{ width: 400 }, { width: 1 }] })).toBe(false);
  });

  it('never calls a paragraph factory with an over-budget width and rejects extra soft wraps', () => {
    const huge = { ...request, revision: 'huge', text: 'complete original text', paragraphWidth: 4_000_000, paragraphLayoutWidth: 1_000_000, paragraphDirection: 'ltr' as const };
    const makeParagraph = jest.fn(() => ({
      getLineMetrics: () => [{ width: 200, left: 0 }],
      getShapedLines: () => [{ runs: [{ glyphs: new Uint16Array([1]), positions: new Float32Array([0, 0, 10, 0]), typeface: typeface(), size: 12, scaleX: 1 }] }],
    }));
    const provider = new WebShapedRunProvider(makeParagraph, () => ({ setScaleX: jest.fn() }));

    expect(provider.prepare(huge)).toMatchObject({ state: 'ready', program: { kind: 'shaped-runs' } });
    expect(makeParagraph).toHaveBeenCalledWith(huge);
    expect(new WebShapedRunProvider(() => ({
      getLineMetrics: () => [{ width: 100, left: 0 }, { width: 100, left: 0 }],
      getShapedLines: () => [],
    }), () => ({ setScaleX: jest.fn() })).prepare(huge)).toEqual({ state: 'unsupported', reason: 'unsafe-layout' });
  });

  it('reports invalid shaped lines when font preflight cannot construct every run font', () => {
    const provider = new WebShapedRunProvider(() => ({
      getShapedLines: () => [{ runs: [{ glyphs: new Uint16Array([1]), positions: new Float32Array([0, 0, 10, 0]), typeface: typeface(), size: 12, scaleX: 1 }] }],
    }), () => null);
    expect(provider.prepare(request)).toEqual({ state: 'unsupported', reason: 'invalid-shaped-lines' });
  });
});
