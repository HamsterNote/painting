// Retained text editing and mixed selection behavior on the layered runtime.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TextEditor } from '../layered/TextEditor';
import { SelectionOverlay } from '../layered/SelectionOverlay';
import { createLayeredToolSession } from '../core/layeredToolSession';
import { makeLayeredController } from './fixtures/layered';
import { layeredImage, layeredText } from './fixtures/layeredDom';

function editExisting() {
  const controller = makeLayeredController([layeredText, layeredImage]);
  controller.setTool('text');
  const close = jest.fn();
  render(
    <TextEditor
      controller={controller}
      point={{ x: 60, y: 60 }}
      allocateId={() => 'unused'}
      close={close}
    />
  );
  return { controller, close, input: screen.getByLabelText('文字内容') };
}

test('existing text edits once while preserving geometry, image and document order', () => {
  const { controller, close, input } = editExisting();
  const before = controller.getSnapshot('document');
  expect(input).toHaveProperty('value', layeredText.content);
  fireEvent.change(input, { target: { value: '新内容\nالعربية 😀' } });
  expect(controller.getSnapshot('document')).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  const after = controller.getSnapshot('document');
  expect(after.documentRevision).toBe(before.documentRevision + 1);
  expect(after.objects.map((o) => o.objectId)).toEqual(['text', 'image']);
  expect(after.objects[0]).toMatchObject({
    kind: 'text',
    content: '新内容\nالعربية 😀',
    localBounds: { ...layeredText.localBounds, maxY: 150 },
    transform: layeredText.transform,
  });
  expect(after.objects[1]).toEqual(layeredImage);
  expect(close).toHaveBeenCalledTimes(1);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toEqual(before.objects);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  controller.redo();
  expect(controller.getSnapshot('document').objects).toEqual(after.objects);
});

test('unchanged completion closes without creating history', () => {
  const { controller, close } = editExisting();
  const before = controller.getSnapshot('document');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  expect(controller.getSnapshot('document')).toBe(before);
  expect(close).toHaveBeenCalledTimes(1);
});

test('clearing existing text removes only that object, undo restores exact content', () => {
  const { controller, input } = editExisting();
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(controller.getSnapshot('document').objects).toEqual([layeredImage]);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toEqual([layeredText, layeredImage]);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});

test('stale edit cannot overwrite a newer document revision', () => {
  const { controller, close, input } = editExisting();
  fireEvent.change(input, { target: { value: 'stale' } });
  controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['image'] });
  const current = controller.getSnapshot('document');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(screen.getByRole('alert').textContent).toContain('invalid-input');
  expect(controller.getSnapshot('document')).toBe(current);
  expect(close).not.toHaveBeenCalled();
});

test.each(['move', 'resize', 'rotate'] as const)(
  'mixed text/image selection %s uses reversible transforms and cancel discards preview',
  (operation) => {
    const controller = makeLayeredController([layeredText, layeredImage]);
    controller.setTool('selection');
    controller.setSelection(['text', 'image']);
    const overlay = render(<SelectionOverlay controller={controller} />);
    expect(overlay.container.querySelector('[data-selection-operation="resize"]')).toBeTruthy();
    expect(overlay.container.querySelector('[data-selection-operation="rotate"]')).toBeTruthy();
    const session = createLayeredToolSession(controller, () => 'unused');
    const before = controller.getSnapshot('document');
    act(() => {
      session.begin({ x: 350, y: 130 }, operation);
      session.update([{ x: 400, y: 180 }]);
    });
    expect(controller.getSnapshot('preview').objects).toHaveLength(2);
    expect(controller.getSnapshot('document')).toBe(before);
    act(() => {
      session.cancel();
    });
    expect(controller.getSnapshot('preview').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    act(() => {
      session.begin({ x: 350, y: 130 }, operation);
      session.update([{ x: 400, y: 180 }]);
      session.end();
    });
    expect(controller.getSnapshot('document').objects[0]).toMatchObject({
      content: layeredText.content,
      fontSize: layeredText.fontSize,
      localBounds: layeredText.localBounds,
    });
    expect(controller.getSnapshot('document').objects[0].transform).not.toEqual(
      layeredText.transform
    );
    act(() => {
      controller.undo();
    });
    expect(controller.getSnapshot('document').objects).toEqual(before.objects);
    session.destroy();
  }
);
