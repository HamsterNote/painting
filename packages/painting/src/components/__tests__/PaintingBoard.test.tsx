import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { DrawingTool } from '../DrawingSurface';
import { PaintingBoard } from '../PaintingBoard';

/** mock getBoundingClientRect，让 DrawingSurface 能正确计算画布坐标 */
function mockHostRect(element: HTMLElement) {
  element.getBoundingClientRect = jest.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  }));
}

/** 构造模拟触摸 PointerEvent（jsdom 无原生 PointerEvent，用 Event + 属性赋值） */
function makeTouchEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave',
  x: number,
  y: number,
  pointerId: number
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerType: 'touch',
    pointerId,
    button: 0,
    clientX: x,
    clientY: y,
    isPrimary: true,
    pressure: type === 'pointerup' || type === 'pointerleave' ? 0 : 0.5,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });
  Object.defineProperty(event, 'timeStamp', { value: 0 });
  return event;
}

describe('PaintingBoard', () => {
  it('默认渲染底部工具栏并激活默认工具 pen', () => {
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" />
      </div>
    );

    const toolbar = screen.getByTestId('painting-board-toolbar');
    expect(toolbar).toBeTruthy();

    const penButton = screen.getByRole('button', { name: 'Pen' });
    expect(penButton.getAttribute('aria-pressed')).toBe('true');
    // 未激活工具为 false
    expect(screen.getByRole('button', { name: 'Rect' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('非受控模式：点击工具按钮切换激活工具并触发 onToolChange', () => {
    const onToolChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" onToolChange={onToolChange} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ellipse' }));

    expect(onToolChange).toHaveBeenCalledWith('ellipse');
    expect(screen.getByRole('button', { name: 'Ellipse' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('受控模式：激活工具完全由 tool prop 决定', () => {
    function ControlledHost() {
      const [tool, setTool] = useState<DrawingTool>('line');
      return (
        <div style={{ width: 400, height: 300 }}>
          <PaintingBoard testID="board" tool={tool} onToolChange={setTool} />
        </div>
      );
    }
    render(<ControlledHost />);

    expect(screen.getByRole('button', { name: 'Line' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.getByRole('button', { name: 'Eraser' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('受控笔触颜色为空时恢复默认黑色而不是沿用旧的内部颜色', () => {
    // Given：先在非受控模式选择蓝色，留下一个非默认内部颜色。
    const { rerender } = render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" />
      </div>
    );
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-preset-1'));
    expect(screen.getByTestId('painting-board-stroke-color-btn').getAttribute('data-color')).toBe(
      '#2563eb'
    );

    // When：父组件切换为受控模式，并用空字符串表达 DrawingSurface 的默认颜色。
    rerender(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" strokeColor="" />
      </div>
    );

    // Then：空受控值应在当前优先级解析为黑色，不能回退到旧的内部蓝色。
    expect(screen.getByTestId('painting-board-stroke-color-btn').getAttribute('data-color')).toBe(
      '#000000'
    );
  });

  it('toolbar=false 时不渲染工具栏', () => {
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" toolbar={false} />
      </div>
    );
    expect(screen.queryByTestId('painting-board-toolbar')).toBeNull();
  });

  it('toolbar.tools 限制展示的工具集合', () => {
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" toolbar={{ tools: ['pen', 'eraser'] }} />
      </div>
    );
    expect(screen.getByRole('button', { name: 'Pen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rect' })).toBeNull();
  });

  it('Given the built-in toolbar When Image is clicked Then it opens an image-only file picker', () => {
    const { container } = render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" />
      </div>
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const clickFileInput = jest.spyOn(HTMLInputElement.prototype, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Image' }));

    expect(fileInput?.accept).toBe('image/*');
    expect(clickFileInput).toHaveBeenCalledTimes(1);
    clickFileInput.mockRestore();
  });

  it('Given a large image When it is imported Then it is centered and capped by half the container', async () => {
    const onChange = jest.fn();
    const readAsDataUrl = jest
      .spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementation(function readFile(this: FileReader) {
        Object.defineProperty(this, 'result', {
          configurable: true,
          value: 'data:image/png;base64,cGFpbnRpbmc=',
        });
        this.dispatchEvent(new ProgressEvent('load'));
      });
    const naturalWidth = jest
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(1000);
    const naturalHeight = jest
      .spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get')
      .mockReturnValue(500);
    const imageSrc = jest
      .spyOn(HTMLImageElement.prototype, 'src', 'set')
      .mockImplementation(function loadImage(this: HTMLImageElement) {
        this.dispatchEvent(new Event('load'));
      });
    const { container } = render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          testID="board"
          defaultViewport={{ scale: 2, tx: 40, ty: 20 }}
          onChange={onChange}
        />
      </div>
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const canvasWrapper = fileInput?.parentElement;
    if (!fileInput || !canvasWrapper) throw new Error('Image input must be inside the canvas wrapper');
    mockHostRect(canvasWrapper);

    fireEvent.change(fileInput, {
      target: { files: [new File(['painting'], 'painting.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      const image = container.querySelector('image[data-image-stroke-id]');
      expect(image?.getAttribute('x')).toBe('30');
      expect(image?.getAttribute('y')).toBe('40');
      expect(image?.getAttribute('width')).toBe('100');
      expect(image?.getAttribute('height')).toBe('50');
    });
    expect(onChange).toHaveBeenCalledWith({
      strokes: [
        expect.objectContaining({
          tool: 'image',
          points: [
            { x: 30, y: 40 },
            { x: 130, y: 90 },
          ],
          src: 'data:image/png;base64,cGFpbnRpbmc=',
        }),
      ],
    });

    imageSrc.mockRestore();
    naturalHeight.mockRestore();
    naturalWidth.mockRestore();
    readAsDataUrl.mockRestore();
  });

  // ===== 手写笔模式 / 重置视角 / 清空画布 =====

  it('渲染手写笔模式、重置视角、清空画布三个按钮且初始状态正确', () => {
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" />
      </div>
    );

    // 手写笔模式按钮始终渲染，默认激活（aria-pressed=true）
    const stylusToggle = screen.getByTestId('painting-board-stylus-toggle');
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('true');

    // 重置视角按钮渲染
    expect(screen.getByTestId('painting-board-reset-view')).toBeTruthy();

    // 清空画布按钮渲染
    expect(screen.getByTestId('painting-board-clear-canvas')).toBeTruthy();
  });

  it('点击重置视角按钮：onViewportChange 以默认 viewport 回调', () => {
    const onViewportChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" onViewportChange={onViewportChange} />
      </div>
    );

    fireEvent.click(screen.getByTestId('painting-board-reset-view'));

    // normalizeViewport(DEFAULT_DRAWING_VIEWPORT) = { scale: 1, tx: 0, ty: 0 }
    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({ scale: 1, tx: 0, ty: 0 })
    );
  });

  it('点击重置视角按钮：传入 defaultViewport 时重置回初始视口', () => {
    const onViewportChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          testID="board"
          defaultViewport={{ scale: 2, tx: 5, ty: 5 }}
          onViewportChange={onViewportChange}
        />
      </div>
    );

    fireEvent.click(screen.getByTestId('painting-board-reset-view'));

    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({ scale: 2, tx: 5, ty: 5 })
    );
  });

  it('点击清空画布按钮：onChange 以空 strokes 回调', () => {
    const onChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" onChange={onChange} />
      </div>
    );

    fireEvent.click(screen.getByTestId('painting-board-clear-canvas'));

    expect(onChange).toHaveBeenCalledWith({ strokes: [] });
  });

  it('非受控模式：点击手写笔模式按钮翻转 aria-pressed 并触发 onStylusModeChange', () => {
    const onStylusModeChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" onStylusModeChange={onStylusModeChange} />
      </div>
    );

    const stylusToggle = screen.getByTestId('painting-board-stylus-toggle');
    // 默认手写笔模式开启
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(stylusToggle);

    // 回调收到 false（关闭手写笔模式）
    expect(onStylusModeChange).toHaveBeenCalledWith(false);
    // 非受控：内部状态翻转，aria-pressed 变为 false
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('受控模式：aria-pressed 由 stylusMode prop 决定，点击仍通知 onStylusModeChange', () => {
    const onStylusModeChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" stylusMode={false} onStylusModeChange={onStylusModeChange} />
      </div>
    );

    const stylusToggle = screen.getByTestId('painting-board-stylus-toggle');
    // 受控：prop 为 false，aria-pressed=false
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(stylusToggle);

    // 回调收到 true（期望开启手写笔模式）
    expect(onStylusModeChange).toHaveBeenCalledWith(true);
    // 受控：prop 未变，aria-pressed 不变
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('手写笔模式关闭（stylusMode=false）：单指触摸触发绘图（onChange 回调）', () => {
    const onChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" stylusMode={false} onChange={onChange} />
      </div>
    );

    // DrawingSurface 宿主元素（SVG host）
    const host = screen.getByTestId('board');
    mockHostRect(host);

    // 模拟单指触摸绘图：pointerdown → pointermove → pointerleave → pointerup
    // stylusMode=false 时 enabledInteractions 不含 touchSingleFingerPan，
    // 单指触摸回落到绘图通道，应产生 stroke 并触发 onChange
    act(() => {
      host.dispatchEvent(makeTouchEvent('pointerdown', 50, 50, 1));
      host.dispatchEvent(makeTouchEvent('pointermove', 100, 100, 1));
      host.dispatchEvent(makeTouchEvent('pointerleave', 0, 0, 1));
      host.dispatchEvent(makeTouchEvent('pointerup', 0, 0, 1));
    });

    expect(onChange).toHaveBeenCalled();
  });

  it('手写笔模式开启（stylusMode=true）：单指触摸不触发绘图（被 virtualPaper 拦截用于平移）', () => {
    const onChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" stylusMode={true} onChange={onChange} />
      </div>
    );

    const host = screen.getByTestId('board');
    mockHostRect(host);

    // stylusMode=true 时 virtualPaper 使用安全默认交互集（含 touchSingleFingerPan），
    // 单指触摸被 virtualPaper 拦截用于平移画布，不应产生 stroke（onChange 不触发）
    act(() => {
      host.dispatchEvent(makeTouchEvent('pointerdown', 50, 50, 1));
      host.dispatchEvent(makeTouchEvent('pointermove', 100, 100, 1));
      host.dispatchEvent(makeTouchEvent('pointerleave', 0, 0, 1));
      host.dispatchEvent(makeTouchEvent('pointerup', 0, 0, 1));
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
