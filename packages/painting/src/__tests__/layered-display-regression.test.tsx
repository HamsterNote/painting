import { act, render } from '@testing-library/react';
import { DisplayLayer } from '../layered/DisplayLayer';
import { PresentationCoordinator } from '../layered/PresentationCoordinator';
import { layeredRect, makeLayeredController, commitLayeredStroke } from './fixtures/layered';
import { layeredText, layeredImage } from './fixtures/layeredDom';
import type { ShapeObject } from '../model/document';

test.each(['line', 'rect', 'ellipse', 'polygon', 'bezier'] as const)(
  '%s uses shared geometry and shape-only dash style',
  (shapeType) => {
    const shape: ShapeObject = {
      ...layeredRect(),
      shapeType,
      points:
        shapeType === 'polygon' || shapeType === 'bezier'
          ? [
              { x: 0, y: 0 },
              { x: 40, y: 10 },
              { x: 20, y: 40 },
              { x: 60, y: 60 },
            ]
          : [
              { x: 0, y: 0 },
              { x: 60, y: 60 },
            ],
      style: { color: '#123456', width: 3, opacity: 0.4, dash: [4, 2] },
    };
    const controller = makeLayeredController([shape]);
    const queue = new PresentationCoordinator(controller);
    const { container, unmount } = render(
      <DisplayLayer controller={controller} presentation={queue} />
    );
    const path = container.querySelector('path')!;
    expect(path.getAttribute('d')).toBeTruthy();
    expect(path.getAttribute('stroke')).toBe('#123456');
    expect(path.getAttribute('stroke-width')).toBe('3');
    expect(path.getAttribute('stroke-dasharray')).toBe('4 2');
    expect(path.getAttribute('opacity')).toBe('0.4');
    unmount();
    queue.destroy();
  }
);

test('history preserves arbitrary text/image/shape/ink order and raw data through transforms and undo', () => {
  const controller = makeLayeredController([layeredText, layeredRect(), layeredImage]);
  commitLayeredStroke(controller, 'ink');
  const queue = new PresentationCoordinator(controller);
  const { container, unmount } = render(
    <DisplayLayer controller={controller} presentation={queue} />
  );
  const ids = () =>
    Array.from(container.querySelectorAll('[data-object-id]')).map((node) =>
      node.getAttribute('data-object-id')
    );
  expect(ids()).toEqual(['text', 'rect', 'image', 'object-ink']);
  const before = controller.getSnapshot('document');
  act(() => {
    controller.editObjects({
      expectedDocumentRevision: before.documentRevision,
      upsert: [
        {
          ...layeredText,
          objectRevision: 2,
          transformRevision: 2,
          transform: { a: 0, b: 1, c: -1, d: 0, tx: 50, ty: 20 },
        },
      ],
    });
  });
  expect(ids()).toEqual(['text', 'rect', 'image', 'object-ink']);
  expect(container.querySelector('[data-object-id="text"]')?.getAttribute('transform')).toBe(
    'matrix(0 1 -1 0 50 20)'
  );
  expect(container.querySelector('foreignObject')?.textContent).toBe(layeredText.content);
  expect(container.querySelector('image')?.getAttribute('href')).toBe(layeredImage.src);
  const ink = container.querySelector('[data-object-id="object-ink"] path')!;
  expect(ink.getAttribute('fill')).not.toBe('none');
  expect(ink.getAttribute('stroke-dasharray')).toBeNull();
  act(() => {
    controller.undo();
  });
  expect(controller.getSnapshot('document').objects).toEqual(before.objects);
  unmount();
  queue.destroy();
});
