import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import { layeredRect, makeLayeredController } from './fixtures/layered';

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
