/** @jest-environment node */

import { canonicalizeClosedRing, hitTestNonzeroRings, intersectClosedRingWithRect } from '../../core';

describe('core/polygonBoolean', () => {
  it('uses robust nonzero winding rather than even-odd for a twice-wound star region', () => {
    const ring = [
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 },
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 },
    ];
    // even-odd 会将两次同向绕行抵消；canonical nonzero 不会。
    expect(hitTestNonzeroRings([ring], { x: 6, y: 6 }, 0)).toBe(true);
    expect(hitTestNonzeroRings([[...ring].reverse()], { x: 6, y: 6 }, 0)).toBe(true);
  });

  it('respects reversed hole winding and keeps edge tolerance in the same fill predicate', () => {
    const outer = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const hole = [{ x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 }];
    expect(hitTestNonzeroRings([outer, hole], { x: 2, y: 2 }, 0)).toBe(true);
    expect(hitTestNonzeroRings([outer, hole], { x: 10, y: 10 }, 0)).toBe(false);
    expect(hitTestNonzeroRings([outer, hole], { x: 5.2, y: 10 }, 0.25)).toBe(true);
  });

  it('canonicalizes self-intersection and returns compound rect intersections instead of empty fallback', () => {
    const bowTie = [{ x: -10, y: 0 }, { x: 10, y: 20 }, { x: -10, y: 20 }, { x: 10, y: 0 }];
    const canonical = canonicalizeClosedRing(bowTie);
    const clipped = intersectClosedRingWithRect(bowTie, { minX: -2, minY: 0, maxX: 8, maxY: 20 });
    expect(canonical).toMatchObject({ ok: true });
    expect(clipped).toMatchObject({ ok: true });
    if (!clipped.ok) throw new Error('expected polygon intersection to succeed');
    expect(clipped.polygons.length).toBeGreaterThan(0);
  });

  it('turns a polyclip exception into clip-failed rather than an empty frame result', () => {
    jest.resetModules();
    jest.doMock('polyclip-ts', () => ({
      union: () => { throw new Error('mocked polygon failure'); },
      intersection: () => { throw new Error('mocked polygon failure'); },
    }));
    let clipped: { status: string; diagnostic?: { reason: string } } | undefined;
    jest.isolateModules(() => {
      const core = require('../../core') as typeof import('../../core');
      const prepared = core.prepareDrawingDocument({
        schemaVersion: 2,
        strokes: [{
          schemaVersion: 2, id: 'failed-clip', tool: 'polygon', fillColor: '#000',
          points: [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }],
        }],
      });
      clipped = core.clipPreparedDrawingEntry(prepared.entries[0], { x: 0, y: 0 }, { minX: -1, minY: -1, maxX: 21, maxY: 21 }, 100);
    });
    jest.dontMock('polyclip-ts');

    expect(clipped).toMatchObject({ status: 'unresolved', diagnostic: { reason: 'clip-failed' } });
  });
});
