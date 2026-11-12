import {
  deriveLayeredSelectionGeometry,
  hitLayeredSelectionGeometry,
} from '../../core/layeredSelectionGeometry';
import { layeredRect, makeLayeredController } from '../fixtures/layered';

test.each(['ellipse', 'line'] as const)(
  '%s empty frame, enclosing bands and inclusive edges are interactive',
  (shapeType) => {
    const controller = makeLayeredController([
      { ...layeredRect(), shapeType, style: { color: '#000', width: 2, opacity: 1 } },
    ]);
    controller.setTool('selection');
    controller.setSelection(['rect']);
    const geometry = deriveLayeredSelectionGeometry(controller)!;
    expect(hitLayeredSelectionGeometry(geometry, { x: 30, y: 50 })).toBe('move');
    const { region, frame } = geometry;
    for (const point of [
      { x: region.minX, y: 40 },
      { x: region.maxX, y: 40 },
      { x: 20, y: region.minY },
      { x: 20, y: region.maxY },
      { x: 20, y: frame.minY - 15 },
    ])
      expect(hitLayeredSelectionGeometry(geometry, point)).toBe('move');
    expect(hitLayeredSelectionGeometry(geometry, { x: region.maxX + 0.001, y: 40 })).toBeNull();
    expect(
      hitLayeredSelectionGeometry(geometry, { x: geometry.rotate.x, y: geometry.rotate.y })
    ).toBe('rotate');
    expect(hitLayeredSelectionGeometry(geometry, { x: frame.maxX, y: frame.maxY })).toBe('resize');
  }
);

test.each([0.5, 1, 2])(
  'zoom %s with transformed objects keeps screen handle extents and multiselect gap',
  (scale) => {
    const controller = makeLayeredController([
      { ...layeredRect('a'), transform: { a: 0, b: 2, c: -2, d: 0, tx: 200, ty: 0 } },
      { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 0 } },
    ]);
    controller.setTool('selection');
    controller.setSelection(['a', 'b']);
    controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale, tx: 37, ty: 49 },
    });
    const geometry = deriveLayeredSelectionGeometry(controller)!;
    expect(geometry.resize.maxX - geometry.resize.minX).toBe(10);
    expect(geometry.frame.minY - geometry.region.minY).toBe(26);
    expect(hitLayeredSelectionGeometry(geometry, { x: 300 * scale + 37, y: 50 * scale + 49 })).toBe(
      'move'
    );
    controller.setSelection([]);
    expect(deriveLayeredSelectionGeometry(controller)).toBeNull();
    controller.setSelection(['a']);
    controller.setTool('eraser');
    expect(deriveLayeredSelectionGeometry(controller)).toBeNull();
  }
);
