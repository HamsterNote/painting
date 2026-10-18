import { fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from '../layered/Toolbar';
import { makeLayeredController } from './fixtures/layered';
import { createEditor } from '../layered/createEditor';
import { INPUT_MODE_PREFERENCE_KEY as key } from '../layered/inputModePreference';

test('freehand controls are isolated from shape dash and algorithm settings', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  expect(screen.queryByLabelText('形状线型')).toBeNull();
  expect(screen.getByLabelText('压力模式')).toHaveProperty('value', 'auto');
  expect(screen.getAllByRole('slider')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  fireEvent.change(screen.getByLabelText('形状线型'), { target: { value: 'dash' } });
  fireEvent.click(screen.getByRole('button', { name: '自由笔' }));
  fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: '24' } });
  fireEvent.change(screen.getByLabelText('压力模式'), { target: { value: 'constant' } });
  expect(screen.queryByLabelText('形状线型')).toBeNull();
  expect(controller.getSnapshot('tools').settings.freehand).toEqual({
    color: '#008060',
    nominalSize: 24,
    opacity: 0.5,
    pressureMode: 'constant',
    presetRevision: 1,
  });
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  expect(screen.getByLabelText('形状线型')).toHaveProperty('value', 'dash');
  expect(screen.getByLabelText('笔宽')).toHaveProperty('value', '2');
});

test('input menu is available for every tool, restores preferences and writes no undo', () => {
  localStorage.setItem(key, '"pen"');
  const controller = createEditor();
  const history = controller.getSnapshot('history');
  render(<Toolbar controller={controller} />);
  expect(screen.getByRole('combobox', { name: '输入模式' })).toHaveProperty('value', 'pen');
  expect(
    [...screen.getByLabelText<HTMLSelectElement>('输入模式').options].map((option) => option.text)
  ).toEqual(['自动', '强制手指绘制', '强制手写笔绘制']);
  fireEvent.click(screen.getByRole('button', { name: '平移' }));
  fireEvent.change(screen.getByLabelText('输入模式'), { target: { value: 'finger' } });
  expect(controller.getSnapshot('tools').activeTool).toBe('pan');
  expect(controller.getSnapshot('input').mode).toBe('finger');
  expect(localStorage.getItem(key)).toBe('"finger"');
  expect(controller.getSnapshot('history')).toBe(history);
  localStorage.clear();
});
