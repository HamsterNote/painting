import { createNavigationWebAdapter } from '../layered/navigationWebAdapter';
import { createFreehandWebAdapter } from '../input/web/freehandWebAdapter';
import { makeLayeredController } from './fixtures/layered';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { readLayeredDocument, serializeLayeredDocument } from '../model/documentReader';
import { deriveFreehandGeometry } from '../geometry/freehand';
import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';

function pointer(
  target: EventTarget,
  phase: string,
  id: number,
  x: number,
  y: number,
  source = 'touch',
  modifiers = {}
) {
  const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: id,
    pointerType: source,
    clientX: x,
    clientY: y,
    button: 0,
    ...modifiers,
  });
  target.dispatchEvent(event);
}

test('touch navigation keeps its fixed pair, rejects third contacts, and never replays a palm after writing', () => {
  const controller = makeLayeredController();
  const host = document.createElement('div');
  document.body.append(host);
  const adapter = createNavigationWebAdapter(host, controller);
  pointer(host, 'down', 1, 100, 100);
  pointer(host, 'down', 2, 200, 100);
  pointer(window, 'move', 2, 300, 100);
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 2, tx: -100, ty: -100 });
  const before = controller.getSnapshot('viewport');
  pointer(host, 'down', 3, 400, 400);
  pointer(window, 'move', 3, 600, 600);
  expect(controller.getSnapshot('viewport')).toBe(before);
  pointer(window, 'up', 1, 100, 100);
  pointer(window, 'move', 2, 500, 500);
  expect(controller.getSnapshot('viewport')).toBe(before);
  pointer(window, 'up', 2, 500, 500);
  pointer(window, 'up', 3, 600, 600);
  controller.beginFreehand({
    type: 'begin',
    commitId: 'pen',
    pressureCapability: 'available',
    batch: {
      sessionId: 'pen',
      pointerId: 9,
      source: 'pen',
      coordinateSpace: 'world',
      viewportRevision: before.revision,
      batchSequence: 0,
      samples: [{ sequence: 0, x: 10, y: 10, phase: 'down', time: 0 }],
    },
  });
  pointer(host, 'down', 4, 0, 0);
  pointer(window, 'move', 4, 50, 50);
  controller.cancelFreehand({
    type: 'cancel',
    sessionId: 'pen',
    pointerId: 9,
    source: 'pen',
    batchSequence: 1,
    reason: 'explicit',
  });
  pointer(window, 'move', 4, 90, 90);
  pointer(window, 'up', 4, 90, 90);
  expect(controller.getSnapshot('viewport')).toBe(before);
  adapter.destroy();
  host.remove();
});

test('ruler pointer gestures and minimap/paper state do not write history or viewport', () => {
  const controller = makeLayeredController();
  controller.setNavigation({
    ruler: { visible: true, center: { x: 200, y: 200 }, rotationRad: 0, height: 80 },
    paper: true,
    minimap: true,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const adapter = createNavigationWebAdapter(host, controller);
  const saved = controller.getSnapshot('document');
  const viewport = controller.getSnapshot('viewport');
  pointer(host, 'down', 1, 200, 200, 'mouse', { ctrlKey: true });
  pointer(window.document, 'move', 1, 250, 230, 'mouse', { ctrlKey: true });
  pointer(window.document, 'up', 1, 250, 230, 'mouse', { ctrlKey: true });
  expect(controller.getSnapshot('navigation').ruler.center).toEqual({ x: 250, y: 230 });
  pointer(host, 'down', 2, 300, 230, 'mouse', { altKey: true });
  pointer(window.document, 'move', 2, 250, 280, 'mouse', { altKey: true });
  pointer(window.document, 'up', 2, 250, 280, 'mouse', { altKey: true });
  expect(controller.getSnapshot('navigation').ruler.rotationRad).toBeCloseTo(Math.PI / 2);
  expect(controller.getSnapshot('document')).toBe(saved);
  expect(controller.getSnapshot('viewport')).toBe(viewport);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  adapter.destroy();
  host.remove();
});

test('ruler locks a local snapshot at begin, preserves raw input through JSON/history, and invalidates geometry', () => {
  const controller = makeLayeredController();
  controller.setNavigation({
    ruler: { visible: true, center: { x: 200, y: 200 }, rotationRad: 0, height: 80 },
  });
  controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: 0, ty: 0 },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const adapter = createFreehandWebAdapter({
    host,
    controller,
    createSessionId: () => 's',
    createCommitId: () => 'c',
  });
  pointer(host, 'down', 1, 100, 120, 'pen');
  expect(controller.setNavigation({ paper: true }).ok).toBe(false);
  pointer(window, 'move', 1, 400, 190, 'pen');
  pointer(window, 'up', 1, 600, 190, 'pen');
  const object = controller.getSnapshot('document').objects[0];
  expect(object?.kind).toBe('freehand');
  if (object.kind !== 'freehand') throw new Error('missing ink');
  expect(object.rulerSnapshot).toEqual({ center: { x: 100, y: 100 }, height: 40, rotationRad: 0 });
  expect(object.samples.map(({ x, y }) => [x, y])).toEqual([
    [50, 60],
    [200, 95],
    [300, 95],
  ]);
  const constrained = deriveFreehandGeometry(object, 'final');
  const unconstrained = deriveFreehandGeometry({ ...object, rulerSnapshot: undefined }, 'final');
  expect(constrained.localBounds.maxY).toBeLessThan(unconstrained.localBounds.maxY - 10);
  const cache = new FreehandGeometryCache();
  const first = cache.getGeometry(object, 'final');
  const different = {
    ...object,
    rulerSnapshot: { ...object.rulerSnapshot!, rotationRad: Math.PI / 2 },
  };
  expect(cache.getGeometry(different, 'final')).not.toBe(first);
  expect(cache.getGeometry(different, 'final').geometryRevision).not.toBe(first.geometryRevision);
  const serialized = serializeLayeredDocument(controller.getSnapshot('document'));
  if (!serialized.ok) throw new Error(serialized.error.code);
  expect(readLayeredDocument(JSON.parse(serialized.value))).toEqual({
    ok: true,
    value: controller.getSnapshot('document'),
  });
  // Reader accepts the immutable constraint while rejecting malformed constraints.
  const read = readLayeredDocument(controller.getSnapshot('document'));
  expect(read.ok && read.value.objects[0]).toEqual(object);
  expect(
    readLayeredDocument({
      schemaVersion: 3,
      documentRevision: 0,
      objects: [{ ...object, rulerSnapshot: { ...object.rulerSnapshot, height: NaN } }],
    }).ok
  ).toBe(false);
  const samples = object.samples;
  controller.undo();
  controller.redo();
  expect(controller.getSnapshot('document').objects[0]).toBe(object);
  expect(object.samples).toBe(samples);
  adapter.destroy();
  host.remove();
});

test('virtual paper options independently gate mouse/pen/touch/wheel navigation and zoom limits', () => {
  const controller = makeLayeredController();
  const host = document.createElement('div');
  document.body.append(host);
  const config = controller.getSnapshot('navigation').virtualPaper;
  controller.setNavigation({
    virtualPaper: {
      ...config,
      minScale: 0.5,
      maxScale: 1.5,
      enabledInteractions: ['mouseDragPan', 'penPan', 'mouseWheelZoom', 'touchTwoFingerZoom'],
    },
  });
  const navigation = createNavigationWebAdapter(host, controller);
  const semantic = createSemanticWebAdapter({
    host,
    controller,
    allocateId: () => 'unused',
    onText: jest.fn(),
    onError: (error) => {
      throw error;
    },
  });
  pointer(host, 'down', 1, 10, 20, 'mouse');
  pointer(window, 'move', 1, 60, 70, 'mouse');
  pointer(window, 'up', 1, 60, 70, 'mouse');
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 1, tx: 50, ty: 50 });
  pointer(host, 'down', 2, 10, 20, 'pen');
  pointer(window, 'move', 2, 60, 70, 'pen');
  pointer(window, 'up', 2, 60, 70, 'pen');
  expect(controller.getSnapshot('viewport').viewport).toEqual({ scale: 1, tx: 100, ty: 100 });
  host.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, cancelable: true }));
  expect(controller.getSnapshot('viewport').viewport.scale).toBe(1.5);
  pointer(host, 'down', 3, 100, 100);
  pointer(window, 'move', 3, 150, 150);
  const beforePair = controller.getSnapshot('viewport');
  pointer(host, 'down', 4, 200, 100);
  pointer(window, 'move', 4, 400, 100);
  expect(controller.getSnapshot('viewport').viewport.scale).toBe(1.5);
  expect(controller.getSnapshot('viewport')).toBe(beforePair);
  pointer(window, 'up', 3, 150, 150);
  pointer(window, 'up', 4, 400, 100);
  controller.setNavigation({ virtualPaper: { ...config, enabled: false } });
  const disabled = controller.getSnapshot('viewport');
  host.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true }));
  pointer(host, 'down', 5, 100, 100);
  pointer(window, 'move', 5, 200, 200);
  pointer(window, 'up', 5, 200, 200);
  expect(controller.getSnapshot('viewport')).toBe(disabled);
  semantic.destroy();
  navigation.destroy();
  host.remove();
});
