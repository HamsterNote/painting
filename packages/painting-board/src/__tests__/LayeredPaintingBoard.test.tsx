import { act, fireEvent, render, screen } from '@testing-library/react';
import { LayeredPaintingBoard } from '../index';
import { createEditor } from '@hamster-note/painting/layered';

test('board toolbar and surface use the same controller with isolated document renders', () => {
  const controller = createEditor();
  const renderObserver = jest.fn();
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill',
    ].map((key) => [key, jest.fn()])
  );
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const board = render(<LayeredPaintingBoard controller={controller} onRender={renderObserver} />);
  expect(screen.getByTestId('layered-surface')).toBeTruthy();
  const before = renderObserver.mock.calls.length;
  fireEvent.change(screen.getByLabelText('压力模式'), { target: { value: 'constant' } });
  expect(controller.getSnapshot('tools').settings.freehand.pressureMode).toBe('constant');
  expect(renderObserver).toHaveBeenCalledTimes(before);
  act(() => controller.setTool('rect'));
  expect(screen.getByRole('button', { name: '矩形' }).getAttribute('aria-pressed')).toBe('true');
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  board.unmount();
  jest.restoreAllMocks();
});
