import { act, render, screen } from '@testing-library/react';
import { NavigationOverlay } from '../layered/NavigationOverlay';
import { makeLayeredController, layeredRect, commitLayeredStroke } from './fixtures/layered';
import {
  layeredImage,
  layeredText,
  layeredPointer as pointer,
  mockLayeredDom,
} from './fixtures/layeredDom';

beforeEach(() => {
  mockLayeredDom();
});
afterEach(() => jest.restoreAllMocks());

test('minimap includes mixed geometry and obeys controller visibility', () => {
  const controller = makeLayeredController([layeredRect(), layeredText, layeredImage]);
  commitLayeredStroke(controller, 'ink');
  render(<NavigationOverlay controller={controller} />);
  expect(screen.queryByTestId('layered-minimap')).toBeNull();
  act(() => {
    controller.setNavigation({ minimap: true });
  });
  const map = screen.getByTestId('layered-minimap');
  expect(map.querySelectorAll('path')).toHaveLength(2);
  expect(map.querySelectorAll('image')).toHaveLength(1);
  expect(map.querySelector('foreignObject')?.textContent).toBe('Hamster 中文');
  act(() => {
    controller.setNavigation({ minimap: false });
  });
  expect(screen.queryByTestId('layered-minimap')).toBeNull();
});

test('minimap drag changes only authoritative viewport and preserves scale/history', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setNavigation({ minimap: true });
  controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: -20, ty: -20 },
  });
  render(<NavigationOverlay controller={controller} />);
  const map = screen.getByTestId('layered-minimap');
  Object.assign(map, { setPointerCapture: jest.fn() });
  const document = controller.getSnapshot('document');
  pointer(map, 'down', 100, 80, 'mouse');
  const current = controller.getSnapshot('viewport');
  expect(current.revision).toBeGreaterThan(1);
  expect(current.viewport.scale).toBe(2);
  pointer(map, 'move', 130, 100, 'mouse');
  expect(controller.getSnapshot('viewport').viewport).not.toEqual(current.viewport);
  pointer(map, 'up', 130, 100, 'mouse');
  const ended = controller.getSnapshot('viewport');
  pointer(map, 'move', 150, 110, 'mouse');
  expect(controller.getSnapshot('viewport')).toBe(ended);
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});

test('transformed off-paper geometry and a far viewport produce finite map projection', () => {
  const object = {
    ...layeredRect(),
    transform: { a: 2, b: 0, c: 0, d: 2, tx: -5000, ty: 3000 },
    transformRevision: 2,
  };
  const controller = makeLayeredController([object]);
  controller.setNavigation({ minimap: true });
  controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 0.25, tx: 10000, ty: -20000 },
  });
  render(<NavigationOverlay controller={controller} />);
  const map = screen.getByTestId('layered-minimap');
  const projection = map.querySelector(':scope > g')!.getAttribute('transform');
  expect(projection).toEqual(expect.stringContaining('scale('));
  expect(projection).not.toMatch(/NaN|Infinity/);
  expect(Number(screen.getByTestId('minimap-viewport').getAttribute('width'))).toBe(3200);
  expect(map.querySelector('path')).toBeTruthy();
  expect(map.querySelectorAll('rect').length).toBeGreaterThan(0);
});
