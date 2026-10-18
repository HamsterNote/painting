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

test.each(['rect', 'lasso', 'eraser', 'selection', 'bezier', 'polygon'] as const)(
  '%s touch transaction cancels before pair and late up cannot edit history',
  (tool) => {
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
