import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Toolbar } from '../layered/Toolbar';
import { createEditor } from '../layered/createEditor';
import { installNativeToolbarKeyboard } from '../../../../apps/playground/src/layered-editor/nativeToolbarKeyboard';

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test('inline settings focus a page control, edit all settings, and never mount native pickers', () => {
  const controller = createEditor();
  const view = render(<Toolbar controller={controller} inlinePickers />);
  const settings = screen.getByRole('button', { name: '设置' });
  fireEvent.click(settings);
  expect(document.activeElement).toBe(
    within(screen.getByRole('group', { name: '输入模式' })).getByLabelText('自动')
  );
  expect(view.container.querySelector('select,input[type=color]')).toBeNull();
  fireEvent.click(screen.getByLabelText('强制手指绘制'));
  expect(controller.getSnapshot('input').mode).toBe('finger');
  fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
  const strokePanel = screen.getByRole('dialog', { name: '笔触设置' });
  fireEvent.click(screen.getByLabelText('恒定'));
  const color = within(strokePanel).getByRole('textbox', { name: '颜色' });
  fireEvent.change(color, { target: { value: '#123456' } });
  expect(controller.getSnapshot('tools').settings.freehand).toMatchObject({
    color: '#123456',
    pressureMode: 'constant',
  });
  fireEvent.change(color, { target: { value: '#bad!' } });
  expect(color.getAttribute('aria-invalid')).toBe('true');
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#123456');
  fireEvent.blur(color);
  expect(color).toHaveProperty('value', '#123456');
  fireEvent.keyDown(strokePanel, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '笔触设置' }));
  fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
  fireEvent.click(screen.getByRole('button', { name: '自由取色' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '颜色' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(view.container.querySelector('select,input[type=color]')).toBeNull();
});

test('inline shape choices preserve the shape settings contract', () => {
  const controller = createEditor();
  controller.setTool('rect');
  render(<Toolbar controller={controller} inlinePickers />);
  fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
  fireEvent.click(screen.getByLabelText('虚线'));
  expect(controller.getSnapshot('tools').settings.shape.dash).toEqual([8, 5]);
  expect(screen.queryByRole('group', { name: '压力模式' })).toBeNull();
});

test('reopening settings focuses the selected radio, which participates in Tab order', () => {
  const controller = createEditor();
  render(<Toolbar controller={controller} inlinePickers />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByLabelText('强制手写笔绘制'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(document.activeElement).toBe(screen.getByLabelText('强制手写笔绘制'));
});

test('settings bridge yields color to WebKit Tab, restores traversal and closes on range Escape', async () => {
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement
  ) {
    return (this.hidden ? [] : [new DOMRect(0, 0, 44, 44)]) as unknown as DOMRectList;
  });
  const controller = createEditor();
  render(<Toolbar controller={controller} inlinePickers />);
  let scope = '';
  const dispose = installNativeToolbarKeyboard(document, async (next) => {
    scope = next;
  });
  let sequence = 0;
  const key = (key: 'Escape' | 'Tab', shiftKey = false) =>
    window.__paintingToolbarKeyboard!.receive({
      scope,
      sequence: ++sequence,
      key,
      shiftKey,
      source: 'ios-key-command',
    });
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 16; i++) await Promise.resolve();
    });
  try {
    fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
    await settle();
    act(() => {
      expect(key('Escape')).toBe(true);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
    await settle();
    const openedScope = scope;
    expect(openedScope).not.toBe('');
    act(() => {
      screen.getByRole('button', { name: '自由取色' }).focus();
    });
    await settle();
    act(() => {
      expect(key('Tab')).toBe(true);
    });
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '颜色' }));
    expect(scope).toBe('');
    expect(window.__paintingToolbarKeyboard!.snapshot()).toMatchObject({
      tabOnly: true,
      acknowledgedTabOnly: false,
    });
    expect(key('Escape')).toBe(false); // Color Escape belongs to WebKit, not the bridge.
    // Exercise the color Tab handler itself; do not supply the missing focus.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('textbox', { name: '颜色' }), tab);
    expect(tab.defaultPrevented).toBe(true);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('slider', { name: '不透明度' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(scope).toBe(openedScope);
    act(() => {
      expect(key('Escape')).toBe(true);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '笔触设置' }));
    await settle();
    act(() => {
      expect(key('Tab', true)).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Reverse traversal lands on the last enabled primary action (clear is disabled).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '移动' }));
  } finally {
    dispose();
    await settle();
  }
});
