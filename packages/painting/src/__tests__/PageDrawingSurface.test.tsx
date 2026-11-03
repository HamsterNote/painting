import { act, render, screen } from '@testing-library/react';
import { createEditor, PageDrawingSurface, migrateLegacyDocument } from '../index';
import { layeredPointer, mockLayeredDom } from './fixtures/layeredDom';
import type { PageGeometry } from '../geometry/pageCoordinates';
import { IDENTITY_TRANSFORM } from '../model/document';

afterEach(() => jest.restoreAllMocks());

test.each([0.1, 1, 2.5, 16])('page input uses stable DIP at host zoom %s and scroll', (scale) => {
  mockLayeredDom();
  const controller = createEditor();
  controller.setFreehandSettings({
    color: '#ff00cc',
    nominalSize: 3,
    opacity: 1,
    pressureMode: 'constant',
    presetRevision: 1,
  });
  const geometry = {
    width: 600,
    height: 800,
    pageToSurface: { ...IDENTITY_TRANSFORM, a: scale, d: scale },
  };
  render(<PageDrawingSurface pageId="page-1" controller={controller} geometry={geometry} />);
  const host = screen.getByTestId('layered-surface');
  const outer = screen.getByTestId('page-drawing-surface');
  let scroll = 40;
  outer.getBoundingClientRect = () =>
    ({ left: 25, top: scroll, width: 600 * scale, height: 800 * scale }) as DOMRect;
  expect(host.style.background).toBe('transparent');
  layeredPointer(host, 'down', 25 + 10 * scale, scroll + 20 * scale);
  act(() => {
    controller.setFreehandSettings({
      color: '#00ff00',
      nominalSize: 7,
      opacity: 1,
      pressureMode: 'constant',
      presetRevision: 2,
    });
  });
  scroll = -150;
  layeredPointer(window, 'move', 25 + 30 * scale, scroll + 40 * scale);
  layeredPointer(window, 'up', 25 + 50 * scale, scroll + 60 * scale);
  const document = controller.getSnapshot('document');
  expect(document.objects).toHaveLength(1);
  expect(document.objects[0]).toMatchObject({
    kind: 'freehand',
    brushSnapshot: { color: '#ff00cc', nominalSize: 3 },
  });
  const object = document.objects[0]!;
  if (object.kind !== 'freehand') throw new Error('Expected freehand');
  object.samples.forEach((sample, i) => {
    expect(sample.x).toBeCloseTo(10 + i * 20, 9);
    expect(sample.y).toBeCloseTo(20 + i * 20, 9);
  });
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 1, tx: 0, ty: 0 });
  expect(
    screen
      .getByTestId('layered-display')
      .querySelector('[data-object-id] path')
      ?.getAttribute('fill')
  ).toBe('#ff00cc');
});

test('rotated semantic input and saved shape style share the page transform', () => {
  mockLayeredDom();
  const migrated = migrateLegacyDocument({
    strokes: [
      {
        id: 'saved',
        tool: 'rect',
        points: [
          { x: 10, y: 20 },
          { x: 40, y: 50 },
        ],
        strokeColor: '#123456',
        strokeWidth: 2,
        fillColor: '#aabbcc',
        fillOpacity: 0.2,
        dashArray: [2, 4],
        dashOffset: 3,
      },
    ],
  });
  if (!migrated.ok) throw new Error(migrated.error.path);
  const controller = createEditor(migrated.value);
  controller.setTool('rect');
  const geometry: PageGeometry = {
    width: 600,
    height: 800,
    pageToSurface: { a: 0, b: 2, c: -2, d: 0, tx: 1600, ty: 0 },
  };
  render(<PageDrawingSurface pageId="page-2" controller={controller} geometry={geometry} />);
  const host = screen.getByTestId('layered-surface');
  const path = screen.getByTestId('layered-display').querySelector('[data-object-id="saved"] path');
  expect(path?.getAttribute('fill-opacity')).toBe('0.2');
  expect(path?.getAttribute('stroke-dashoffset')).toBe('3');
  layeredPointer(host, 'down', 1560, 20);
  layeredPointer(window, 'move', 1500, 80);
  layeredPointer(window, 'up', 1500, 80);
  expect(controller.getSnapshot('document').objects[1]).toMatchObject({
    kind: 'shape',
    points: [
      { x: 10, y: 20 },
      { x: 40, y: 50 },
    ],
  });
});

test('switching page or transform cancels partial ink and rejects late up', () => {
  mockLayeredDom();
  const first = createEditor(),
    second = createEditor();
  const geometry = { width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM };
  const view = render(
    <PageDrawingSurface pageId="page-1" controller={first} geometry={geometry} />
  );
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 10, 20);
  layeredPointer(window, 'move', 30, 40);
  view.rerender(<PageDrawingSurface pageId="page-2" controller={second} geometry={geometry} />);
  layeredPointer(window, 'up', 50, 60);
  expect(first.getSnapshot('document').objects).toHaveLength(0);
  expect(second.getSnapshot('document').objects).toHaveLength(0);
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 10, 20);
  view.rerender(
    <PageDrawingSurface
      pageId="page-2"
      controller={second}
      geometry={{ ...geometry, pageToSurface: { ...IDENTITY_TRANSFORM, a: 2, d: 2 } }}
    />
  );
  layeredPointer(window, 'up', 50, 60);
  expect(second.getSnapshot('document').objects).toHaveLength(0);
});

test('host page navigation cannot change controller viewport; invalid geometry disables input', () => {
  mockLayeredDom();
  const controller = createEditor();
  const geometry = { width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM };
  const view = render(
    <PageDrawingSurface pageId="page-1" controller={controller} geometry={geometry} />
  );
  act(() => {
    controller.setTool('pan');
  });
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 10, 20, 'mouse');
  layeredPointer(window, 'move', 50, 60, 'mouse');
  layeredPointer(window, 'up', 50, 60, 'mouse');
  act(() => {
    controller.updateViewport({
      type: 'replace',
      expectedRevision: controller.getSnapshot('viewport').revision,
      viewport: { scale: 2, tx: 20, ty: 30 },
    });
  });
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 1, tx: 0, ty: 0 });
  view.rerender(
    <PageDrawingSurface
      pageId="page-1"
      controller={controller}
      geometry={{ ...geometry, width: 0 }}
    />
  );
  expect(screen.getByTestId('layered-surface').style.pointerEvents).toBe('none');
});

test('ancestor CSS zoom and coalesced samples use one inverse map per batch', () => {
  mockLayeredDom();
  const controller = createEditor();
  const geometry = {
    width: 600,
    height: 800,
    pageToSurface: { ...IDENTITY_TRANSFORM, a: 2, d: 2 },
  };
  render(<PageDrawingSurface pageId="page-1" controller={controller} geometry={geometry} />);
  const outer = screen.getByTestId('page-drawing-surface');
  Object.defineProperties(outer, { offsetWidth: { value: 1200 }, offsetHeight: { value: 1600 } });
  outer.getBoundingClientRect = jest.fn(
    () => ({ left: 25, top: 40, width: 3600, height: 4800 }) as DOMRect
  );
  const host = screen.getByTestId('layered-surface');
  layeredPointer(host, 'down', 25 + 10 * 6, 40 + 20 * 6);
  const sample = (x: number, y: number) => ({
    pointerId: 1,
    pointerType: 'pen',
    clientX: 25 + x * 6,
    clientY: 40 + y * 6,
    pressure: 0.5,
    timeStamp: 1,
  });
  const move = new Event('pointermove', { bubbles: true, cancelable: true });
  const { timeStamp: _time, ...eventFields } = sample(99, 99);
  Object.assign(move, eventFields, { getCoalescedEvents: () => [sample(30, 40), sample(50, 60)] });
  act(() => {
    window.dispatchEvent(move);
  });
  layeredPointer(window, 'up', 25 + 70 * 6, 40 + 80 * 6);
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    samples: [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
      { x: 70, y: 80 },
    ],
  });
});

test('reopened pages can draw when saved object and commit IDs collide with fresh counters', () => {
  mockLayeredDom();
  const geometry = { width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM };
  const first = createEditor();
  const view = render(
    <PageDrawingSurface pageId="page-1" controller={first} geometry={geometry} />
  );
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 10, 20);
  layeredPointer(window, 'up', 30, 40);
  const saved = first.getSnapshot('document');
  const object = saved.objects[0]!;
  if (object.kind !== 'freehand') throw new Error('Expected freehand');
  const editorNumber = Number(object.objectId.match(/^editor-(\d+)/)![1]);
  const surfaceNumber = Number(object.commitId.match(/^surface-(\d+)/)![1]);
  view.unmount();
  const reopened = createEditor({
    ...saved,
    objects: [
      {
        ...object,
        objectId: `editor-${editorNumber + 1}-object-1`,
        commitId: `surface-${surfaceNumber + 1}-commit-1`,
      },
    ],
  });
  render(<PageDrawingSurface pageId="page-1" controller={reopened} geometry={geometry} />);
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 50, 60);
  layeredPointer(window, 'up', 70, 80);
  expect(reopened.getSnapshot('document').objects).toHaveLength(2);
  expect(
    new Set(reopened.getSnapshot('document').objects.map((object) => object.objectId)).size
  ).toBe(2);
});

test('fractional page sizes do not round input coordinates through offsetWidth', () => {
  mockLayeredDom();
  const controller = createEditor();
  render(
    <PageDrawingSurface
      pageId="fractional"
      controller={controller}
      geometry={{ width: 500.25, height: 700.25, pageToSurface: IDENTITY_TRANSFORM }}
    />
  );
  const outer = screen.getByTestId('page-drawing-surface');
  outer.style.width = '500.25px';
  outer.style.height = '700.25px';
  Object.defineProperties(outer, { offsetWidth: { value: 500 }, offsetHeight: { value: 700 } });
  outer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000.5, height: 1400.5 }) as DOMRect;
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 900, 1200);
  layeredPointer(window, 'up', 960, 1300);
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    samples: [
      { x: 450, y: 600 },
      { x: 480, y: 650 },
    ],
  });
});

test('disabling input cancels the active transaction and does not block the underlying page', () => {
  mockLayeredDom();
  const controller = createEditor();
  const geometry = { width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM };
  const view = render(
    <PageDrawingSurface pageId="page-1" controller={controller} geometry={geometry} />
  );
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 10, 20);
  view.rerender(
    <PageDrawingSurface
      pageId="page-1"
      controller={controller}
      geometry={geometry}
      enabled={false}
    />
  );
  layeredPointer(window, 'up', 30, 40);
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(screen.getByTestId('page-drawing-surface').style.pointerEvents).toBe('none');
  expect(screen.getByTestId('layered-surface').dataset.inputArbiter).toBeUndefined();
});

test('a second finger cancels partial ink without moving the page viewport', () => {
  mockLayeredDom();
  const controller = createEditor(undefined, { inputMode: 'finger' });
  render(
    <PageDrawingSurface
      pageId="page-1"
      controller={controller}
      geometry={{ width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM }}
    />
  );
  const host = screen.getByTestId('layered-surface');
  layeredPointer(host, 'down', 10, 20, 'touch', 1);
  layeredPointer(window, 'move', 30, 40, 'touch', 1);
  layeredPointer(host, 'down', 50, 60, 'touch', 2);
  layeredPointer(window, 'up', 70, 80, 'touch', 1);
  layeredPointer(window, 'up', 90, 100, 'touch', 2);
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 1, tx: 0, ty: 0 });
  expect(controller.getSnapshot('interaction').activeFreehand?.status).not.toBe('collecting');
});
