import { deriveLayeredSelectionGeometry } from '../core/layeredSelectionGeometry';
import { applyAffine } from '../geometry/affine';
import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import { layeredRect, makeLayeredController } from './fixtures/layered';
import { createNavigationWebAdapter } from '../layered/navigationWebAdapter';
import { createLayeredInputArbiter } from '../input/web/layeredInputArbiter';

function pointer(target: EventTarget, phase: string, x: number, y: number, pointerType = 'mouse') {
  const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType, clientX: x, clientY: y, button: 0 });
  target.dispatchEvent(event);
}

test('DOM hover/click identity delegates, while captured eraser uses the whole geometry sweep', () => {
  const controller = makeLayeredController([
    layeredRect('a'),
    { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 160, ty: 0 } },
  ]);
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-object-id="a"><path /></g></svg>';
  document.body.append(host);
  const node = host.querySelector('path')!;
  const error = jest.fn();
  const adapter = createSemanticWebAdapter({
    host,
    controller,
    allocateId: () => 'new',
    onText: jest.fn(),
    onError: error,
  });
  pointer(node, 'move', 10, 10);
  expect(host.dataset.hoverObjectId).toBe('a');
  controller.setTool('selection');
  pointer(node, 'down', 50, 50);
  pointer(window, 'up', 50, 50);
  expect(controller.getSnapshot('selection')).toEqual(['a']);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  controller.setTool('eraser');
  pointer(node, 'down', -40, 50);
  pointer(node, 'move', 310, 50);
  expect(controller.getSnapshot('preview').hiddenIds).toEqual(['a', 'b']);
  expect(controller.getSnapshot('document').objects).toHaveLength(2);
  pointer(window, 'up', 310, 50);
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toHaveLength(2);
  expect(error).not.toHaveBeenCalled();
  adapter.destroy();
  host.remove();
});

test('source policy and ownership preserve live mouse tools and cancel touch previews', () => {
  const controller = makeLayeredController();
  controller.setTool('rect');
  const host = document.createElement('div');
  document.body.append(host);
  const adapter = createSemanticWebAdapter({
    host,
    controller,
    allocateId: () => 'rect',
    onText: jest.fn(),
    onError: (error) => {
      throw error;
    },
    policy: { mouse: 'draw', touch: 'none', pen: 'draw' },
  });
  pointer(host, 'down', 10, 10, 'touch');
  pointer(window, 'move', 50, 50, 'touch');
  expect(controller.getSnapshot('preview').objects).toHaveLength(0);
  pointer(host, 'down', 10, 10);
  pointer(window, 'move', 50, 50);
  expect(controller.getSnapshot('preview').objects).toHaveLength(1);
  pointer(window, 'up', 80, 80, 'pen');
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  pointer(window, 'cancel', 50, 50);
  expect(controller.getSnapshot('preview').objects).toHaveLength(0);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  adapter.destroy();
  host.remove();
});

test.each(['rect', 'lasso', 'eraser', 'bezier', 'polygon'] as const)(
  '%s touch transaction cancels before pair and late up cannot edit history',
  async (tool) => {
    const controller = makeLayeredController([layeredRect()]);
    controller.setTool(tool);
    controller.setSelection(['rect']);
    controller.setNavigation({
      virtualPaper: { ...controller.getSnapshot('navigation').virtualPaper, enabled: false },
    });
    const host = document.createElement('div');
    document.body.append(host);
    let arbiter: ReturnType<typeof createLayeredInputArbiter>;
    const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
      listen: false,
      canNavigate: () => !arbiter?.isWriting(),
    });
    const semantic = createSemanticWebAdapter({
      host,
      controller,
      listen: false,
      allocateId: () => 'new',
      onText: jest.fn(),
      onError: (error) => {
        throw error;
      },
    });
    arbiter = createLayeredInputArbiter({ host, controller, tool: semantic, navigation });
    const send = (phase: string, id: number, x: number, y: number) => {
      const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
      Object.assign(event, {
        pointerId: id,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        button: 0,
      });
      (phase === 'down' ? host : window).dispatchEvent(event);
    };
    const saved = controller.getSnapshot('document');
    send('down', 1, 10, 10);
    send('move', 1, 80, 80);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(controller.getSnapshot('preview')).not.toEqual({ objects: [], hiddenIds: [], path: [] });
    send('down', 2, 180, 80);
    expect(controller.getSnapshot('preview')).toEqual({ objects: [], hiddenIds: [], path: [] });
    send('move', 2, 280, 120);
    expect(controller.getSnapshot('viewport').viewport.scale).toBeGreaterThan(1);
    send('up', 1, 80, 80);
    send('up', 2, 280, 120);
    expect(controller.getSnapshot('document')).toBe(saved);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    arbiter.destroy();
    semantic.destroy();
    navigation.destroy();
    host.remove();
  }
);

describe.each(['bezier', 'polygon'] as const)('%s staged cancellation', (tool) => {
  test.each(['mode', 'blur', 'hidden'] as const)(
    '%s cancels between releases and prevents the old shape from completing',
    (interruption) => {
      const controller = makeLayeredController();
      controller.setTool(tool);
      const host = document.createElement('div');
      document.body.append(host);
      const semantic = createSemanticWebAdapter({
        host,
        controller,
        listen: false,
        allocateId: () => 'shape',
        onText: jest.fn(),
        onError: (error) => {
          throw error;
        },
      });
      const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
        listen: false,
      });
      const arbiter = createLayeredInputArbiter({ host, controller, tool: semantic, navigation });
      const click = (x: number, y: number) => {
        pointer(host, 'down', x, y);
        pointer(window, 'up', x, y);
      };
      pointer(host, 'down', 20, 20);
      pointer(window, 'move', 100, 20);
      pointer(window, 'up', 100, 20);
      if (tool === 'polygon') {
        click(100, 20);
        click(100, 100);
      }
      const preview = controller.getSnapshot('preview');
      expect(preview.objects.length + preview.path.length).toBeGreaterThan(0);
      if (interruption === 'mode') controller.setInputMode('finger');
      else if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
      else {
        const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        visibility.mockRestore();
      }
      expect(controller.getSnapshot('preview')).toEqual({ objects: [], hiddenIds: [], path: [] });
      pointer(window, 'up', 100, 100);
      if (tool === 'bezier') {
        click(40, 80);
        click(80, 80);
      } else host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
      expect(controller.getSnapshot('document').objects).toHaveLength(0);
      expect(controller.getSnapshot('history').canUndo).toBe(false);
      arbiter.destroy();
      semantic.destroy();
      navigation.destroy();
      host.remove();
    }
  );
});

test.each(['auto', 'finger'] as const)(
  '%s captured selection handle keeps its resize transaction when a paper finger arrives',
  (mode) => {
    const controller = makeLayeredController([layeredRect()]);
    controller.setInputMode(mode);
    controller.setTool('selection');
    controller.setSelection(['rect']);
    controller.setNavigation({
      virtualPaper: { ...controller.getSnapshot('navigation').virtualPaper, enabled: false },
    });
    const host = document.createElement('div');
    host.innerHTML = '<svg><rect data-selection-operation="resize" /></svg>';
    document.body.append(host);
    const handle = host.querySelector('rect')!;
    const semantic = createSemanticWebAdapter({
      host,
      controller,
      listen: false,
      allocateId: () => 'new',
      onText: jest.fn(),
      onError: (error) => {
        throw error;
      },
    });
    const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
      listen: false,
    });
    const arbiter = createLayeredInputArbiter({ host, controller, tool: semantic, navigation });
    const send = (target: EventTarget, phase: string, id: number, x: number, y: number) => {
      const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
      Object.assign(event, {
        pointerId: id,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        button: 0,
      });
      target.dispatchEvent(event);
    };
    const original = controller.getSnapshot('document');
    const viewport = controller.getSnapshot('viewport');
    const history = controller.getSnapshot('history');
    send(handle, 'down', -101, 100, 100);
    send(host, 'move', -101, 150, 150);
    const preview = controller.getSnapshot('preview');
    expect(preview.objects).toHaveLength(1);
    expect(preview.objects[0].transform).toEqual({ a: 2, b: 0, c: 0, d: 2, tx: -50, ty: -50 });
    send(host, 'down', -102, 250, 150);
    send(host, 'move', -102, 350, 200);
    expect(controller.getSnapshot('preview')).toEqual(preview);
    expect(controller.getSnapshot('document')).toBe(original);
    expect(controller.getSnapshot('history')).toEqual(history);
    expect(controller.getSnapshot('viewport')).toEqual(viewport);
    send(host, 'up', -101, 150, 150);
    const committed = controller.getSnapshot('document');
    expect(committed.objects).toEqual(preview.objects);
    expect(committed.documentRevision).toBe(original.documentRevision + 1);
    send(host, 'up', -102, 350, 200);
    expect(controller.getSnapshot('document')).toBe(committed);
    expect(controller.getSnapshot('viewport')).toEqual(viewport);
    expect(controller.getSnapshot('selection')).toEqual(['rect']);
    controller.undo();
    expect(controller.getSnapshot('document').objects).toEqual(original.objects);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    controller.redo();
    expect(controller.getSnapshot('document').objects).toEqual(committed.objects);
    expect(controller.getSnapshot('history').canRedo).toBe(false);
    arbiter.destroy();
    semantic.destroy();
    navigation.destroy();
    host.remove();
  }
);

function selectionHarness() {
  const controller = makeLayeredController([layeredRect('a'), layeredRect('b')]);
  controller.setTool('selection');
  controller.setSelection(['a']);
  const host = document.createElement('div');
  host.innerHTML = '<svg><g data-object-id="b"><path /></g></svg><button>safe</button>';
  document.body.append(host);
  const error = jest.fn();
  const semantic = createSemanticWebAdapter({
    host,
    controller,
    listen: false,
    allocateId: () => 'new',
    onText: jest.fn(),
    onError: error,
    getClientToLocal: () => (point) => ({ x: (point.x - 100) / 2, y: (point.y - 80) / 2 }),
  });
  const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
    listen: false,
  });
  const arbiter = createLayeredInputArbiter({
    host,
    controller,
    tool: semantic,
    navigation,
    getClientToLocal: () => (point) => ({ x: (point.x - 100) / 2, y: (point.y - 80) / 2 }),
  });
  const send = (
    phase: string,
    x: number,
    y: number,
    source = 'mouse',
    id = 1,
    target: EventTarget = host.querySelector('path')!,
    shiftKey = false
  ) => {
    const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: source,
      clientX: x * 2 + 100,
      clientY: y * 2 + 80,
      button: 0,
      shiftKey,
    });
    (phase === 'down' ? target : window).dispatchEvent(event);
  };
  return {
    controller,
    host,
    error,
    send,
    destroy() {
      arbiter.destroy();
      semantic.destroy();
      navigation.destroy();
      host.remove();
    },
  };
}

test.each([0.5, 1, 2])(
  'selection page affine mapping at zoom %s locks covered target and uses final up',
  (scale) => {
    const h = selectionHarness();
    h.controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale, tx: 37, ty: 49 },
    });
    const before = h.controller.getSnapshot('document');
    h.send(
      'down',
      30 * scale + 37,
      50 * scale + 49,
      'mouse',
      1,
      h.host.querySelector('path')!,
      true
    );
    h.send('move', 30 * scale + 57, 50 * scale + 59);
    h.send('up', 30 * scale + 77, 50 * scale + 79);
    const objects = h.controller.getSnapshot('document').objects;
    expect(objects[0].transform.tx).toBeCloseTo(40 / scale);
    expect(objects[0].transform.ty).toBeCloseTo(30 / scale);
    expect(objects[1]).toEqual(before.objects[1]);
    expect(h.controller.getSnapshot('selection')).toEqual(['a']);
    expect(h.error).not.toHaveBeenCalled();
    h.destroy();
  }
);

test.each(['auto', 'finger', 'pen'] as const)(
  'selection sources respect %s mode and second touch never steals owner',
  (mode) => {
    for (const source of ['mouse', 'pen', 'touch']) {
      const h = selectionHarness();
      h.controller.setInputMode(mode);
      const before = h.controller.getSnapshot('document');
      h.send('down', 30, 50, source);
      h.send('move', 50, 60, source);
      h.send('down', 250, 150, 'touch', 2);
      h.send('move', 300, 200, 'touch', 2);
      h.send('up', 70, 80, source);
      h.send('up', 300, 200, 'touch', 2);
      const expectedTx = mode === 'pen' && source === 'touch' ? 0 : 40;
      expect(h.controller.getSnapshot('document').objects[0].transform.tx).toBe(expectedTx);
      expect(h.controller.getSnapshot('document').objects[1]).toEqual(before.objects[1]);
      expect(h.error).not.toHaveBeenCalled();
      h.destroy();
    }
  }
);

test.each(['cancel', 'escape', 'blur', 'hidden', 'tool', 'mode', 'revision', 'unmount'] as const)(
  'selection %s clears preview and ignores late events',
  (reason) => {
    const h = selectionHarness();
    const before = h.controller.getSnapshot('document');
    h.send('down', 30, 50);
    h.send('move', 70, 80);
    expect(h.controller.getSnapshot('preview').objects).toHaveLength(1);
    if (reason === 'cancel') h.send('cancel', 70, 80);
    if (reason === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'hidden') {
      const spy = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      spy.mockRestore();
    }
    if (reason === 'tool') h.controller.setTool('rect');
    if (reason === 'mode') h.controller.setInputMode('finger');
    if (reason === 'revision')
      h.controller.editObjects({ expectedDocumentRevision: 0, upsert: [{ ...layeredRect('c') }] });
    if (reason === 'unmount') h.destroy();
    const history = h.controller.getSnapshot('history');
    h.send('move', 400, 400);
    h.send('up', 400, 400);
    expect(h.controller.getSnapshot('document').objects.slice(0, 2)).toEqual(before.objects);
    expect(h.controller.getSnapshot('preview')).toEqual({ objects: [], hiddenIds: [], path: [] });
    expect(h.controller.getSnapshot('history')).toEqual(history);
    let nextTx = 0;
    if (reason !== 'unmount') {
      h.controller.setTool('selection');
      h.controller.setSelection(['a']);
      h.send('down', 30, 50);
      h.send('up', 50, 60);
      nextTx = 20;
      h.destroy();
    }
    expect(h.controller.getSnapshot('document').objects[0].transform.tx).toBe(nextTx);
    expect(h.error).not.toHaveBeenCalled();
  }
);

test('frame click is history-free, controls are safe and outside shift/blank retain selection rules', () => {
  const h = selectionHarness();
  h.send('down', 30, 50);
  h.send('up', 30, 50);
  expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  h.send('down', 30, 50, 'mouse', 1, h.host.querySelector('button')!);
  h.send('up', 70, 80);
  expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  h.send('down', 300, 300, 'mouse', 1, h.host.querySelector('path')!, true);
  h.send('up', 300, 300);
  expect(h.controller.getSnapshot('selection')).toEqual(['a', 'b']);
  h.send('down', 400, 400, 'mouse', 1, h.host);
  h.send('up', 400, 400);
  expect(h.controller.getSnapshot('selection')).toEqual([]);
  h.destroy();
});

test('auto pen latch keeps frame touches in navigation and leaves document unchanged', () => {
  const h = selectionHarness();
  h.controller.recordPenDown();
  const before = h.controller.getSnapshot('document');
  h.send('down', 30, 50, 'touch');
  h.send('up', 70, 80, 'touch');
  expect(h.controller.getSnapshot('document')).toBe(before);
  expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  h.destroy();
});

test.each(['resize', 'rotate'] as const)(
  'coordinate %s handle beats covering DOM object',
  (operation) => {
    const h = selectionHarness();
    const before = h.controller.getSnapshot('document');
    const start = operation === 'resize' ? { x: 101, y: 101 } : { x: 50, y: -21 };
    h.send('down', start.x, start.y);
    h.send('up', start.x + 30, start.y + 20);
    const objects = h.controller.getSnapshot('document').objects;
    expect(objects[0].transform.a).not.toBe(before.objects[0].transform.a);
    expect(objects[1]).toEqual(before.objects[1]);
    expect(h.controller.getSnapshot('selection')).toEqual(['a']);
    expect(h.error).not.toHaveBeenCalled();
    h.destroy();
  }
);

test.each([
  'cancel',
  'escape',
  'blur',
  'capture-then-cancel',
  'hidden',
  'tool',
  'mode',
  'unmount',
] as const)(
  'rotated selection %s restores committed geometry and rejects non-owner/late input',
  (reason) => {
    const h = selectionHarness();
    const geometry = () => deriveLayeredSelectionGeometry(h.controller)!;
    const direction = () =>
      (Math.atan2(geometry().localToHost.b, geometry().localToHost.a) * 180) / Math.PI;
    const rotate = (degrees: number, release: boolean) => {
      const g = geometry();
      const start = applyAffine(g.localToHost, g.rotate)!;
      const center = applyAffine(g.localToHost, {
        x: (g.frame.minX + g.frame.maxX) / 2,
        y: (g.frame.minY + g.frame.maxY) / 2,
      })!;
      const a = (degrees * Math.PI) / 180,
        dx = start.x - center.x,
        dy = start.y - center.y;
      const end = {
        x: center.x + Math.cos(a) * dx - Math.sin(a) * dy,
        y: center.y + Math.sin(a) * dx + Math.cos(a) * dy,
      };
      h.send('down', start.x, start.y);
      h.send('move', end.x, end.y);
      if (release) h.send('up', end.x, end.y);
    };
    rotate(30, true);
    expect(direction()).toBeCloseTo(30);
    const before = h.controller.getSnapshot('document');
    rotate(30, false);
    expect(direction()).toBeCloseTo(60);
    h.send('move', 400, 400, 'mouse', 2);
    h.send('up', 400, 400, 'mouse', 2);
    expect(direction()).toBeCloseTo(60);
    if (reason === 'capture-then-cancel') {
      const e = new Event('lostpointercapture', { bubbles: true });
      Object.assign(e, { pointerId: 1, pointerType: 'mouse' });
      h.host.dispatchEvent(e);
    }
    expect(direction()).toBeCloseTo(60);
    expect(h.controller.getSnapshot('document')).toBe(before);
    if (reason === 'cancel' || reason === 'capture-then-cancel') h.send('cancel', 0, 0);
    if (reason === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'hidden') {
      const spy = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      spy.mockRestore();
    }
    if (reason === 'tool') h.controller.setTool('rect');
    if (reason === 'mode') h.controller.setInputMode('finger');
    if (reason === 'unmount') h.destroy();
    h.send('move', 400, 400);
    h.send('up', 400, 400);
    expect(h.controller.getSnapshot('document')).toBe(before);
    expect(h.controller.getSnapshot('preview').objects).toHaveLength(0);
    h.controller.setTool('selection');
    expect(direction()).toBeCloseTo(reason === 'tool' || reason === 'unmount' ? 0 : 30);
    let next: number | null = null;
    if (reason !== 'unmount') {
      rotate(20, true);
      next = direction();
      h.destroy();
    }
    expect(next === null).toBe(reason === 'unmount');
    expect(next ?? 0).toBeCloseTo(reason === 'unmount' ? 0 : reason === 'tool' ? 20 : 50);
    expect(h.error).not.toHaveBeenCalled();
  }
);
