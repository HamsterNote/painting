import { fireEvent, render, screen } from '@testing-library/react';
import { TextEditor } from '../layered/TextEditor';
import { makeLayeredController } from './fixtures/layered';

test('real DOM focus and composition defer Done into one document transaction', () => {
  const controller = makeLayeredController();
  const close = jest.fn();
  render(
    <TextEditor
      controller={controller}
      point={{ x: 20, y: 30 }}
      allocateId={() => 'text'}
      close={close}
    />
  );
  const input = screen.getByLabelText('文字内容');
  expect(document.activeElement).toBe(input);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '中' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '中文\nLatin 👩‍💻' } });
  fireEvent.compositionEnd(input);
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    kind: 'text',
    content: '中文\nLatin 👩‍💻',
  });
  expect(close).toHaveBeenCalledTimes(1);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});

test('cancelling existing text during composition does not change it', () => {
  const controller = makeLayeredController([
    {
      kind: 'text',
      objectId: 'text',
      objectRevision: 1,
      transformRevision: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      content: '原文',
      color: '#000000',
      fontSize: 24,
      localBounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    },
  ]);
  const before = controller.getSnapshot('document');
  const close = jest.fn();
  render(
    <TextEditor
      controller={controller}
      point={{ x: 20, y: 30 }}
      allocateId={() => 'unused'}
      close={close}
    />
  );
  const input = screen.getByLabelText('文字内容');
  expect(input).toHaveProperty('value', '原文');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '修改中' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(controller.getSnapshot('document')).toBe(before);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
});
