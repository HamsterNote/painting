import { makeLayeredController } from '../fixtures/layered';

test('mode and latch belong to one controller, independently of tool, document and history', () => {
  const editor = makeLayeredController();
  const document = editor.getSnapshot('document');
  const history = editor.getSnapshot('history');
  const listener = jest.fn();
  editor.subscribe('input', listener);
  expect(editor.getSnapshot('input')).toEqual({
    mode: 'auto',
    penSeen: false,
    effectiveTouch: 'draw',
  });
  editor.recordPenDown();
  expect(editor.getSnapshot('input').effectiveTouch).toBe('pan');
  const latched = editor.getSnapshot('input');
  editor.recordPenDown();
  editor.setTool('rect');
  expect(editor.getSnapshot('input')).toBe(latched);
  editor.setInputMode('finger');
  expect(editor.getSnapshot('input')).toEqual({
    mode: 'finger',
    penSeen: true,
    effectiveTouch: 'draw',
  });
  editor.setInputMode('auto');
  expect(editor.getSnapshot('input').effectiveTouch).toBe('pan');
  expect(listener).toHaveBeenCalledTimes(3);
  expect(editor.getSnapshot('document')).toBe(document);
  expect(editor.getSnapshot('history')).toBe(history);
  expect(makeLayeredController().getSnapshot('input').penSeen).toBe(false);
});

test('forced pen does not require detection and invalid mode is rejected', () => {
  const editor = makeLayeredController();
  editor.setInputMode('pen');
  expect(editor.getSnapshot('input')).toEqual({
    mode: 'pen',
    penSeen: false,
    effectiveTouch: 'pan',
  });
  expect(editor.setInputMode('invalid' as 'auto').ok).toBe(false);
  expect(editor.getSnapshot('input').mode).toBe('pen');
});
