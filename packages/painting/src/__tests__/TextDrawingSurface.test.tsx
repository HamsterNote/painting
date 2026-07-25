import { fireEvent, render, screen } from '@testing-library/react';
import { DrawingSurface, type DrawingValue } from '../components/DrawingSurface';
import {
  ControlledTextSurface,
  dispatchPointer,
  mockHostRect,
  TEXT_VALUE,
} from '../../testUtils/textDrawingSurface';

describe('DrawingSurface text editing', () => {
  it('places an editable text box at the pointer and persists typed content', () => {
    // Given: 一个空的受控文字画布。
    const onChange = jest.fn();
    render(<ControlledTextSurface onChange={onChange} />);
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户点击画布并输入文字。
    dispatchPointer(host, 'pointerdown', { x: 40, y: 50 });
    const editor = screen.getByTestId('text-editor');
    fireEvent.change(editor, { target: { value: 'Hello text' } });

    // Then: 文本框从点击位置开始，并保存当前颜色、字号和内容。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
      | DrawingValue
      | undefined;
    const textStroke = lastChange?.strokes[0];
    expect(textStroke).toEqual(
      expect.objectContaining({
        tool: 'text',
        text: 'Hello text',
        strokeColor: '#2563eb',
        fontSize: 32,
      })
    );
    expect(textStroke?.points[0]).toEqual(expect.objectContaining({ x: 40, y: 50 }));
    expect(document.activeElement).toBe(editor);
  });

  it('keeps browser focus on the editor created by the placement pointer', () => {
    // Given: 一个空的文字画布，浏览器会在 pointerdown 后执行默认聚焦动作。
    render(<ControlledTextSurface />);
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户点击画布放置文字。
    const pointerDown = dispatchPointer(host, 'pointerdown', { x: 40, y: 50 });

    // Then: 画布消费默认聚焦动作，避免新编辑器立即失焦并删除空文字。
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Text content' }));
  });

  it('grows the persisted text box for multiline content and a larger font size', () => {
    // Given: 一个受控文字框，初始字号为 24。
    const onChange = jest.fn();
    const { rerender } = render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        value={TEXT_VALUE}
        selectedStrokeIds={['text-1']}
        onChange={onChange}
        fontSize={24}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    dispatchPointer(host, 'pointerdown', { x: 60, y: 40 });

    // When: 用户输入两行文字，并把字号调大到 48。
    fireEvent.change(screen.getByRole('textbox', { name: 'Text content' }), {
      target: { value: '第一行\n第二行' },
    });
    rerender(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        value={onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? TEXT_VALUE}
        selectedStrokeIds={['text-1']}
        onChange={onChange}
        fontSize={48}
      />
    );

    // Then: 持久化高度至少容纳两行 48px 文字。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    const points = lastChange.strokes[0]?.points ?? [];
    expect(Math.abs((points[1]?.y ?? 0) - (points[0]?.y ?? 0))).toBeCloseTo(115.2);
  });

  it('grows the text box when a larger font introduces soft wrapping', () => {
    // Given: 一个宽度固定为 160 的中文文字框。
    const onChange = jest.fn();
    const wrappedValue: DrawingValue = {
      strokes: [{ ...TEXT_VALUE.strokes[0], text: '浏览器文字完整显示' }],
    };
    const { rerender } = render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        value={wrappedValue}
        selectedStrokeIds={['text-1']}
        onChange={onChange}
        fontSize={24}
      />
    );

    // When: 用户把字号调大到 48，文字因此产生软换行。
    rerender(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        value={wrappedValue}
        selectedStrokeIds={['text-1']}
        onChange={onChange}
        fontSize={48}
      />
    );

    // Then: 持久化高度同步容纳估算出的三行文字。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    const points = lastChange.strokes[0]?.points ?? [];
    expect(Math.abs((points[1]?.y ?? 0) - (points[0]?.y ?? 0))).toBeCloseTo(172.8);
  });

  it('removes an empty text stroke when editing finishes', () => {
    // Given: 用户刚放置了一个尚未输入内容的文字框。
    const onChange = jest.fn();
    render(<ControlledTextSurface onChange={onChange} />);
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);
    dispatchPointer(host, 'pointerdown', { x: 40, y: 50 });

    // When: 编辑器在空内容状态下失焦。
    fireEvent.blur(screen.getByRole('textbox', { name: 'Text content' }));

    // Then: 空文字元素被从持久化画布中移除。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    expect(lastChange.strokes).toHaveLength(0);
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  it('clears an existing text selection before placing text on a later blank click', () => {
    // Given: 文字工具中已有一个选中的文字框。
    const onChange = jest.fn();
    const onSelectionChange = jest.fn();
    render(
      <DrawingSurface
        testID="text-surface"
        tool="text"
        defaultValue={TEXT_VALUE}
        defaultSelectedStrokeIds={['text-1']}
        onChange={onChange}
        onSelectionChange={onSelectionChange}
      />
    );
    const host = screen.getByTestId('text-surface');
    mockHostRect(host);

    // When: 用户第一次点击空白处。
    dispatchPointer(host, 'pointerdown', { x: 300, y: 200 }, 11);

    // Then: 首次点击只取消选择，不创建新文字。
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('text-editor')).toBeNull();

    // When: 用户再次点击空白处。
    dispatchPointer(host, 'pointerdown', { x: 300, y: 200 }, 12);

    // Then: 第二次点击才创建并编辑新的文字框。
    const lastChange = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as DrawingValue;
    expect(lastChange.strokes).toHaveLength(2);
    expect(lastChange.strokes[1]?.tool).toBe('text');
    expect(screen.getByTestId('text-editor')).toBeTruthy();
  });
});
