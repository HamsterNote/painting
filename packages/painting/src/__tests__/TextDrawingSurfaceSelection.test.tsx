import { fireEvent, render, screen } from '@testing-library/react';
import { DrawingSurface, type DrawingValue } from '../components/DrawingSurface';
import {
  ControlledTextSurface,
  dispatchPointer,
  MIXED_VALUE,
  mockHostRect,
  TEXT_VALUE,
} from '../../testUtils/textDrawingSurface';

describe('DrawingSurface text selection', () => {
  it('does not select a text box from an ordinary drawing tool', () => {
    // Given: 画布含有文字，但当前是钢笔工具。
    const onSelectionChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="text-surface"
        tool="pen"
        value={TEXT_VALUE}
        onSelectionChange={onSelectionChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户点击文字框内部。
    dispatchPointer(host, 'pointerdown', { x: 60, y: 40 });
    dispatchPointer(host, 'pointerup', { x: 60, y: 40 });

    // Then: 普通绘图模式不建立文字选区。
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="text-selection-controls"]')).toBeNull();
  });

  it('selects text with a lasso click and renders only the two side handles', () => {
    // Given: 套索模式下有一个未选中的文字框。
    const onSelectionChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="text-surface"
        tool="lasso"
        value={TEXT_VALUE}
        onSelectionChange={onSelectionChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户单击文字框。
    dispatchPointer(host, 'pointerdown', { x: 60, y: 40 });
    dispatchPointer(host, 'pointerup', { x: 60, y: 40 });

    // Then: 文字被选中，只显示左、右两个边界 handle，且不进入编辑状态。
    expect(onSelectionChange).toHaveBeenCalledWith(['text-1']);
    expect(container.querySelector('[data-testid="text-resize-handle-left"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="text-resize-handle-right"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-lasso-resize-handle]')).toHaveLength(2);
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  it('selects text enclosed by a drawn lasso', () => {
    // Given: 套索模式下有一个文字框。
    const onSelectionChange = jest.fn();
    render(
      <DrawingSurface
        testID="text-surface"
        tool="lasso"
        value={TEXT_VALUE}
        onSelectionChange={onSelectionChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户从文字框外绘制一个闭合套索。
    dispatchPointer(host, 'pointerdown', { x: 10, y: 20 });
    dispatchPointer(host, 'pointermove', { x: 190, y: 20 });
    dispatchPointer(host, 'pointermove', { x: 190, y: 70 });
    dispatchPointer(host, 'pointermove', { x: 10, y: 70 });
    dispatchPointer(host, 'pointerup', { x: 10, y: 20 });

    // Then: 被套住的文字进入选区。
    expect(onSelectionChange).toHaveBeenLastCalledWith(['text-1']);
  });

  it('changes only the right text boundary when the right handle is dragged', () => {
    // Given: 文字模式中已选中一个文字框。
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        defaultValue={TEXT_VALUE}
        defaultSelectedStrokeIds={['text-1']}
        onChange={onChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    const rightHandle = container.querySelector('[data-testid="text-resize-handle-right"]');

    // When: 右 handle 向右拖动 40 个画布单位。
    expect(rightHandle).toBeTruthy();
    if (rightHandle) {
      dispatchPointer(rightHandle, 'pointerdown', { x: 180, y: 44.4 }, 7);
      dispatchPointer(document, 'pointermove', { x: 220, y: 44.4 }, 7);
      dispatchPointer(document, 'pointerup', { x: 220, y: 44.4 }, 7);
    }

    // Then: 左边界与垂直坐标不变，仅右边界移动。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    const resized = lastChange.strokes[0];
    expect(resized?.points[0]).toEqual(expect.objectContaining({ x: 20, y: 30 }));
    expect(resized?.points[1]).toEqual(expect.objectContaining({ x: 220, y: 58.8 }));
  });

  it('moves the selected text when its selection border is dragged', () => {
    // Given: 文字模式中已选中一个文字框，选框边缘可作为移动命中区。
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        defaultValue={TEXT_VALUE}
        defaultSelectedStrokeIds={['text-1']}
        onChange={onChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    const selectionEdge = container.querySelector('[data-testid="text-selection-edge"]');

    // When: 用户把上边缘向右拖动 20、向下拖动 10 个画布单位。
    expect(selectionEdge).toBeTruthy();
    if (selectionEdge) {
      dispatchPointer(selectionEdge, 'pointerdown', { x: 100, y: 22 }, 10);
      dispatchPointer(document, 'pointermove', { x: 120, y: 32 }, 10);
      dispatchPointer(document, 'pointerup', { x: 120, y: 32 }, 10);
    }

    // Then: 整个文字框等距移动，宽高保持不变。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    const moved = lastChange.strokes[0];
    expect(moved?.points[0]).toEqual(expect.objectContaining({ x: 40, y: 40 }));
    expect(moved?.points[1]).toEqual(expect.objectContaining({ x: 200, y: 68.8 }));
  });

  it('keeps an empty text editor alive when its selection border is pressed', () => {
    // Given: 用户刚放置空文字，编辑器仍聚焦且选框边缘已经出现。
    render(<ControlledTextSurface />);
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    dispatchPointer(host, 'pointerdown', { x: 100, y: 80 }, 13);
    const editor = screen.getByRole('textbox', { name: 'Text content' });
    const selectionEdge = screen.getByTestId('text-selection-edge');

    // When: 用户按下透明边缘；若组件没有消费浏览器默认聚焦动作，则模拟真实浏览器
    // 把焦点从 textarea 移走，触发既有的空文字清理逻辑。
    const pointerDown = dispatchPointer(selectionEdge, 'pointerdown', { x: 180, y: 72 }, 14);
    if (!pointerDown.defaultPrevented) {
      fireEvent.blur(editor);
    }

    // Then: 边缘手势必须阻止默认焦点迁移，文字编辑器与选框均保持存在。
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Text content' })).toBe(editor);
    expect(screen.getByTestId('text-selection-controls')).toBeTruthy();
  });

  it('grows the text box height when a side handle makes soft wrapping narrower', () => {
    // Given: 文字模式中已选中一个包含长中文内容的文字框。
    const onChange = jest.fn();
    const narrowValue: DrawingValue = {
      strokes: [{ ...TEXT_VALUE.strokes[0], text: '浏览器文字完整显示' }],
    };
    const { container } = render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        defaultValue={narrowValue}
        defaultSelectedStrokeIds={['text-1']}
        onChange={onChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    const rightHandle = container.querySelector('[data-testid="text-resize-handle-right"]');

    // When: 用户向左拖动右 handle，把宽度从 160 缩小到 80。
    if (rightHandle) {
      dispatchPointer(rightHandle, 'pointerdown', { x: 180, y: 44.4 }, 8);
      dispatchPointer(document, 'pointermove', { x: 100, y: 44.4 }, 8);
      dispatchPointer(document, 'pointerup', { x: 100, y: 44.4 }, 8);
    }

    // Then: 持久化宽度缩小，同时高度增长以容纳新增软换行。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    const resized = lastChange.strokes[0];
    expect(Math.abs((resized?.points[1]?.x ?? 0) - (resized?.points[0]?.x ?? 0))).toBe(80);
    expect(Math.abs((resized?.points[1]?.y ?? 0) - (resized?.points[0]?.y ?? 0))).toBeCloseTo(
      86.4
    );
  });

  it('moves an existing mixed lasso selection when dragging from its text', () => {
    // Given: 套索已同时选中文字与矩形。
    const onChange = jest.fn();
    const onSelectionChange = jest.fn();
    render(
      <DrawingSurface
        testID="text-surface"
        tool="lasso"
        defaultValue={MIXED_VALUE}
        defaultSelectedStrokeIds={['text-1', 'rect-1']}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户从文字区域拖动整个选区。
    dispatchPointer(host, 'pointerdown', { x: 60, y: 40 }, 9);
    dispatchPointer(document, 'pointermove', { x: 80, y: 50 }, 9);
    dispatchPointer(document, 'pointerup', { x: 80, y: 50 }, 9);

    // Then: 选区没有折叠为单个文字，两个元素都一起移动。
    expect(onSelectionChange).not.toHaveBeenCalledWith(['text-1']);
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    expect(lastChange.strokes.find((stroke) => stroke.id === 'text-1')?.points[0]).toEqual(
      expect.objectContaining({ x: 40, y: 40 })
    );
    expect(lastChange.strokes.find((stroke) => stroke.id === 'rect-1')?.points[0]).toEqual(
      expect.objectContaining({ x: 220, y: 40 })
    );
  });

  it('aligns text selection controls with a rotated text stroke', () => {
    // Given: 一个带旋转角的文字元素处于选中状态。
    const rotatedValue: DrawingValue = {
      strokes: [{ ...TEXT_VALUE.strokes[0], rotationRad: Math.PI / 6 }],
    };
    render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        value={rotatedValue}
        selectedStrokeIds={['text-1']}
      />
    );

    // When: 文字选择控件被渲染。
    const controls = screen.getByTestId('text-selection-controls');

    // Then: 控件沿用文字自身的旋转角。
    expect(controls.getAttribute('data-rotation-rad')).toBe(String(Math.PI / 6));
  });
});
