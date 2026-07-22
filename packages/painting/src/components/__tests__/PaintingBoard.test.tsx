import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PaintingBoard } from '../PaintingBoard';
import type { DrawingTool } from '../DrawingSurface';

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
    expect(screen.getByRole('button', { name: 'Rect' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
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
});
