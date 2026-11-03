import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createEditor, PageDrawingSurface } from '../index';
import { layeredPointer, mockLayeredDom } from './fixtures/layeredDom';
import { IDENTITY_TRANSFORM } from '../model/document';

afterEach(() => jest.restoreAllMocks());

test.each(['disabled', 'invalid geometry', 'page', 'geometry', 'controller', 'unmount'])(
  '%s cancels text without retaining an editor or reviving its draft',
  (transition) => {
    mockLayeredDom();
    const controller = createEditor();
    const replacement = createEditor();
    controller.setTool('text');
    replacement.setTool('text');
    const geometry = { width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM };
    const initial = { pageId: 'page-1', controller, geometry, enabled: true };
    const view = render(<PageDrawingSurface {...initial} />);
    layeredPointer(screen.getByTestId('layered-surface'), 'down', 40, 50);
    layeredPointer(window, 'up', 40, 50);
    const input = screen.getByLabelText('文字内容');
    const done = screen.getByRole('button', { name: '完成' });
    const before = controller.getSnapshot('document');
    fireEvent.change(input, { target: { value: 'discard this draft' } });
    if (transition === 'unmount') view.unmount();
    else
      view.rerender(
        <PageDrawingSurface
          {...initial}
          enabled={transition !== 'disabled'}
          pageId={transition === 'page' ? 'page-2' : initial.pageId}
          controller={transition === 'controller' ? replacement : controller}
          geometry={
            transition === 'invalid geometry'
              ? { ...geometry, width: 0 }
              : transition === 'geometry'
                ? { ...geometry, width: 700 }
                : geometry
          }
        />
      );
    // Try both old DOM targets, including the reviewer’s Ctrl+Enter reproduction.
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    fireEvent.click(done);
    expect(controller.getSnapshot('document')).toBe(before);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    expect(replacement.getSnapshot('document').objects).toHaveLength(0);
    expect(screen.queryByLabelText('文字内容')).toBeNull();
    expect(view.container.querySelector('foreignObject')).toBeNull();
    if (transition === 'unmount') render(<PageDrawingSurface {...initial} />);
    else view.rerender(<PageDrawingSurface {...initial} />);
    expect(screen.queryByLabelText('文字内容')).toBeNull();
    layeredPointer(screen.getByTestId('layered-surface'), 'down', 60, 70);
    layeredPointer(window, 'up', 60, 70);
    const fresh = screen.getByLabelText('文字内容');
    expect(fresh).toHaveProperty('value', '');
    fireEvent.change(fresh, { target: { value: 'fresh text' } });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    expect(controller.getSnapshot('document').objects[0]).toMatchObject({ content: 'fresh text' });
  }
);

test('StrictMode text editing works, and disabling a pending IME edit preserves saved text', () => {
  mockLayeredDom();
  const controller = createEditor();
  controller.setTool('text');
  const surface = (enabled: boolean) => (
    <StrictMode>
      <PageDrawingSurface
        pageId="page-1"
        controller={controller}
        geometry={{ width: 600, height: 800, pageToSurface: IDENTITY_TRANSFORM }}
        enabled={enabled}
      />
    </StrictMode>
  );
  const view = render(surface(true));
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 40, 50);
  layeredPointer(window, 'up', 40, 50);
  fireEvent.change(screen.getByLabelText('文字内容'), { target: { value: 'saved text' } });
  fireEvent.keyDown(screen.getByLabelText('文字内容'), { key: 'Enter', ctrlKey: true });
  const saved = controller.getSnapshot('document');
  expect(saved.objects).toHaveLength(1);
  layeredPointer(screen.getByTestId('layered-surface'), 'down', 40, 50);
  layeredPointer(window, 'up', 40, 50);
  const input = screen.getByLabelText('文字内容');
  expect(input).toHaveProperty('value', 'saved text');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '未完成' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  view.rerender(surface(false));
  fireEvent.compositionEnd(input);
  expect(screen.queryByLabelText('文字内容')).toBeNull();
  expect(controller.getSnapshot('document')).toBe(saved);
  act(() => controller.undo());
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});
