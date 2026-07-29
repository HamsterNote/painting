import { isInsideRuler, type RulerRect } from '../geometry';

describe('ruler rectangle geometry', () => {
  const ruler: RulerRect = {
    center: { x: 200, y: 300 },
    length: 400,
    height: 40,
  };

  it('includes its center and visible edges', () => {
    expect(isInsideRuler({ x: 200, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 0, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 400, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 200, y: 280 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 200, y: 320 }, ruler)).toBe(true);
  });

  it('excludes points beyond the visible rectangle', () => {
    expect(isInsideRuler({ x: -0.01, y: 300 }, ruler)).toBe(false);
    expect(isInsideRuler({ x: 400.01, y: 300 }, ruler)).toBe(false);
    expect(isInsideRuler({ x: 200, y: 279.99 }, ruler)).toBe(false);
    expect(isInsideRuler({ x: 200, y: 320.01 }, ruler)).toBe(false);
  });
});
