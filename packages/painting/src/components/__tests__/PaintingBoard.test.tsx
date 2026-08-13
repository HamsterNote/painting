import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { usePaintingHistory } from '../../hooks/usePaintingHistory';
import type { DrawingTool, DrawingValue } from '../DrawingSurface';
import { PaintingBoard } from '../PaintingBoard';
import type { PaintingControllerData } from '../PaintingController';

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
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('使用 colors 配置底栏预设颜色并回写选中的颜色', () => {
    // Given：消费方为 PaintingBoard 提供统一的颜色列表。
    const onStrokeColorChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          testID="board"
          colors={[
            { name: 'Ocean', color: '#0369a1' },
            { name: 'Rose', color: '#be123c' },
          ]}
          onStrokeColorChange={onStrokeColorChange}
        />
      </div>
    );

    // When：打开颜色菜单并选择消费方提供的第二个预设。
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));
    expect(screen.getByText('Ocean')).toBeTruthy();
    expect(screen.getByText('Rose')).toBeTruthy();
    expect(screen.queryByText('Blue')).toBeNull();
    fireEvent.click(screen.getByText('Rose'));

    // Then：选择结果走现有 PaintingBoard 颜色回写通道。
    expect(onStrokeColorChange).toHaveBeenCalledWith('#be123c');
    expect(screen.getByTestId('painting-board-stroke-color-btn').getAttribute('data-color')).toBe(
      '#be123c'
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

  it('非受控模式：底栏尺子开关显示并隐藏尺子且保留配置', () => {
    // Given: 画板提供自定义尺子高度，但初始显式关闭。
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" ruler={{ enabled: false, height: 36 }} />
      </div>
    );
    expect(screen.queryByTestId('drawing-ruler-overlay')).toBeNull();

    // When: 用户从底栏 More 菜单开启尺子。
    fireEvent.click(screen.getByTestId('painting-board-more-btn'));
    fireEvent.click(screen.getByTestId('painting-board-ruler-toggle'));

    // Then: 尺子显示，且原有高度配置没有被底栏状态覆盖。
    expect(screen.getByTestId('drawing-ruler-overlay')).toBeTruthy();
    expect(screen.getByTestId('drawing-ruler').getAttribute('data-ruler-height')).toBe('36');

    // When / Then: 再次切换后尺子隐藏。
    fireEvent.click(screen.getByTestId('painting-board-more-btn'));
    fireEvent.click(screen.getByTestId('painting-board-ruler-toggle'));
    expect(screen.queryByTestId('drawing-ruler-overlay')).toBeNull();
  });

  it('受控模式：底栏尺子开关只通知父组件', () => {
    // Given: rulerVisible 受控为 false。
    const onRulerVisibleChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          testID="board"
          rulerVisible={false}
          onRulerVisibleChange={onRulerVisibleChange}
        />
      </div>
    );

    // When: 用户请求开启尺子。
    fireEvent.click(screen.getByTestId('painting-board-more-btn'));
    fireEvent.click(screen.getByTestId('painting-board-ruler-toggle'));

    // Then: 回调收到期望值，但父组件未回写前 UI 保持关闭。
    expect(onRulerVisibleChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('drawing-ruler-overlay')).toBeNull();
  });

  it('ruler 配置的 enabled 在父组件重渲染时同步可见性', () => {
    // Given: ruler 配置对象直接控制初始可见性和尺寸。
    const { rerender } = render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" ruler={{ enabled: true, height: 36 }} />
      </div>
    );
    expect(screen.getByTestId('drawing-ruler').getAttribute('data-ruler-height')).toBe('36');

    // When / Then: 父组件显式关闭后尺子立即隐藏。
    rerender(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" ruler={false} />
      </div>
    );
    expect(screen.queryByTestId('drawing-ruler-overlay')).toBeNull();

    // When / Then: 父组件再次启用时恢复显示并保留新配置。
    rerender(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" ruler={{ enabled: true, height: 44 }} />
      </div>
    );
    expect(screen.getByTestId('drawing-ruler').getAttribute('data-ruler-height')).toBe('44');
  });

  it('共享 controller 省略 ruler 字段时以关闭处理', () => {
    // Given: controller 已接管画板，但旧数据中没有可选 ruler 字段。
    const data: PaintingControllerData = { tool: 'pen', minimap: false };
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          testID="board"
          ruler={{ enabled: true }}
          rulerVisible
          controller={{ boardId: 'board-a', data, onDataChange: jest.fn() }}
        />
      </div>
    );

    // Then: controller 是唯一状态源，省略字段等价于关闭。
    expect(screen.queryByTestId('drawing-ruler-overlay')).toBeNull();
  });

  it('通过 DrawingSurface 内置 Minimap 渲染并保留配置', () => {
    // Given: jsdom 没有布局尺寸，显式提供 DrawingSurface 读取的宿主宽高。
    const clientWidth = jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(400);
    const clientHeight = jest
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(300);

    try {
      // When: PaintingBoard 同时显示尺子和自定义 Minimap。
      render(
        <div style={{ width: 400, height: 300 }}>
          <PaintingBoard
            testID="board"
            rulerVisible
            minimapVisible
            minimap={{ width: 180, height: 120, position: 'top-right', testID: 'board-minimap' }}
          />
        </div>
      );

      // Then: 只存在 DrawingSurface 内置实例，不再渲染失去尺子归属桥接的外部兄弟节点。
      const minimap = screen.getByTestId('board-minimap');
      expect(minimap.style.width).toBe('180px');
      expect(minimap.style.height).toBe('120px');
      expect(minimap.style.top).toBe('8px');
      expect(minimap.style.right).toBe('8px');
      expect(screen.queryByTestId('painting-board-minimap')).toBeNull();
      expect(screen.getAllByTestId('board-minimap')).toHaveLength(1);
    } finally {
      clientWidth.mockRestore();
      clientHeight.mockRestore();
    }
  });

  it.each([
    ['top-left', 'top', 'left'],
    ['top-right', 'top', 'right'],
    ['bottom-left', 'bottom', 'left'],
    ['bottom-right', 'bottom', 'right'],
  ] as const)(
    'Given a %s minimap When PaintingBoard renders Then it uses the requested corner',
    (position, verticalEdge, horizontalEdge) => {
      // Given: DrawingSurface can resolve a measurable host.
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

      // When: the minimap is initialized at a requested corner without a toolbar.
      render(
        <div style={{ width: 400, height: 300 }}>
          <PaintingBoard
            minimapVisible
            minimap={{ position, testID: `minimap-${position}` }}
            toolbar={false}
          />
        </div>
      );

      // Then: the matching vertical and horizontal edges receive the standard inset.
      const minimap = screen.getByTestId(`minimap-${position}`);
      expect(minimap.style[verticalEdge]).toBe('8px');
      expect(minimap.style[horizontalEdge]).toBe('8px');
    }
  );

  it.each(['bottom-left', 'bottom-right'] as const)(
    'Given the built-in bottom toolbar When a minimap starts at %s Then it clears the toolbar',
    (position) => {
      // Given: a measurable board with its built-in toolbar enabled.
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

      // When: a bottom minimap is rendered.
      render(
        <div style={{ width: 400, height: 300 }}>
          <PaintingBoard minimapVisible minimap={{ position, testID: `minimap-${position}` }} />
        </div>
      );

      // Then: 32px toolbar inset + 42px toolbar height + 8px separation is reserved.
      expect(screen.getByTestId(`minimap-${position}`).style.bottom).toBe('82px');
    }
  );

  it('Given a custom bottom-toolbar inset When a bottom minimap renders Then its clearance follows the toolbar', () => {
    // Given: a measurable board with a custom bottom-toolbar inset.
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    // When: a bottom minimap is rendered beside that toolbar.
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          minimapVisible
          minimap={{ position: 'bottom-right', testID: 'custom-offset-minimap' }}
          toolbar={{ edgeOffset: 20 }}
        />
      </div>
    );

    // Then: 20px toolbar inset + 42px toolbar height + 8px separation is reserved.
    expect(screen.getByTestId('custom-offset-minimap').style.bottom).toBe('70px');
  });

  it('Given a larger explicit minimap offset When a bottom toolbar renders Then the explicit offset is preserved', () => {
    // Given: a measurable board and an explicit offset larger than the toolbar clearance.
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    // When: the bottom minimap is rendered with the built-in toolbar.
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          minimapVisible
          minimap={{ bottomOffset: 120, position: 'bottom-right', testID: 'large-offset-minimap' }}
        />
      </div>
    );

    // Then: toolbar avoidance acts as a minimum rather than replacing the caller's value.
    expect(screen.getByTestId('large-offset-minimap').style.bottom).toBe('120px');
  });

  it('Given a smaller explicit minimap offset When a bottom toolbar renders Then safe clearance wins', () => {
    // Given: a measurable board and an explicit offset that would overlap the toolbar.
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    // When: the bottom minimap is rendered with the built-in toolbar.
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          minimapVisible
          minimap={{ bottomOffset: 24, position: 'bottom-right', testID: 'small-offset-minimap' }}
        />
      </div>
    );

    // Then: the required 82px toolbar clearance is enforced.
    expect(screen.getByTestId('small-offset-minimap').style.bottom).toBe('82px');
  });

  it('Given no toolbar When a custom minimap offset is supplied Then it is preserved exactly', () => {
    // Given: a measurable board without a built-in toolbar.
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    // When: a bottom minimap is rendered with a custom offset.
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          minimapVisible
          minimap={{ bottomOffset: 24, position: 'bottom-right', testID: 'toolbarless-minimap' }}
          toolbar={false}
        />
      </div>
    );

    // Then: no toolbar-derived minimum is injected.
    expect(screen.getByTestId('toolbarless-minimap').style.bottom).toBe('24px');
  });

  it('Given a side toolbar When a bottom minimap renders Then it keeps the standard canvas inset', () => {
    // Given: a measurable board whose toolbar is not docked to the bottom edge.
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    // When: a bottom minimap is rendered with a left-edge toolbar.
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard
          minimapVisible
          minimap={{ position: 'bottom-right', testID: 'side-toolbar-minimap' }}
          toolbar={{ edge: 'left' }}
        />
      </div>
    );

    // Then: no bottom-toolbar clearance is injected.
    expect(screen.getByTestId('side-toolbar-minimap').style.bottom).toBe('8px');
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
    if (!fileInput || !canvasWrapper)
      throw new Error('Image input must be inside the canvas wrapper');
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

    // 手写笔模式按钮始终渲染，默认关闭；关闭时压感没有意义，因此不展示。
    const stylusToggle = screen.getByTestId('painting-board-stylus-toggle');
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('painting-board-pressure-toggle')).toBeNull();

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

  it('受控 value 未被父组件接受时继续渲染父组件提供的内容', () => {
    // Given: 父组件固定提供一条线，并故意不在 onChange 后回写候选值。
    const controlledValue: DrawingValue = {
      strokes: [
        {
          id: 'controlled-line',
          tool: 'line',
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 80 },
          ],
        },
      ],
    };
    const onChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" value={controlledValue} onChange={onChange} />
      </div>
    );
    const host = screen.getByTestId('board');
    expect(host.querySelector('svg > g line')).not.toBeNull();

    // When: 用户请求清空，但父组件拒绝该候选值并保持 value 不变。
    fireEvent.click(screen.getByTestId('painting-board-clear-canvas'));

    // Then: 回调收到候选空值，实际画布仍以受控 value 为唯一渲染真值。
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ strokes: [] });
    expect(host.querySelector('svg > g line')).not.toBeNull();
  });

  it('显式共享 history 时由 history 接收变更并驱动画板 value', () => {
    const staleValue: DrawingValue = {
      strokes: [
        {
          id: 'shared-line',
          tool: 'line',
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 80 },
          ],
        },
      ],
    };

    function SharedHistoryHost() {
      const history = usePaintingHistory({
        shared: staleValue,
      });
      const [data, setData] = useState<PaintingControllerData>({
        tool: 'pen',
        minimap: false,
        selection: null,
      });

      return (
        <div style={{ width: 400, height: 300 }}>
          <PaintingBoard
            testID="board"
            value={staleValue}
            controller={{ boardId: 'shared', data, onDataChange: setData, history }}
          />
        </div>
      );
    }

    // Given: 显式共享 history 与一个不会随 history 更新的旧 value 同时传入。
    render(<SharedHistoryHost />);
    const host = screen.getByTestId('board');
    expect(host.querySelector('svg > g line')).not.toBeNull();

    // When: 画板内置控制器请求清空当前画板。
    fireEvent.click(screen.getByTestId('painting-board-clear-canvas'));

    // Then: 显式 history 是渲染真值，旧 value 不能覆盖清空结果。
    expect(host.querySelector('svg > g line')).toBeNull();
  });

  it('非受控模式：点击手写笔模式按钮翻转 aria-pressed 并触发 onStylusModeChange', () => {
    const onStylusModeChange = jest.fn();
    render(
      <div style={{ width: 400, height: 300 }}>
        <PaintingBoard testID="board" onStylusModeChange={onStylusModeChange} />
      </div>
    );

    const stylusToggle = screen.getByTestId('painting-board-stylus-toggle');
    // 默认手写笔模式关闭，压感入口不展示。
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('painting-board-pressure-toggle')).toBeNull();

    fireEvent.click(stylusToggle);

    // 回调收到 true（开启手写笔模式）。
    expect(onStylusModeChange).toHaveBeenCalledWith(true);
    // 非受控：内部状态翻转，且压感入口随手写笔模式出现。
    expect(stylusToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('painting-board-pressure-toggle')).not.toBeNull();
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
