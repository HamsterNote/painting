import { PaintingBoard } from '@hamster-note/painting-board';
import type { PaintingBoardHandle } from '@hamster-note/painting-board';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

// 单笔画 value fixture，用于验证 value 透传到 DrawingSurface
const SINGLE_STROKE_VALUE = {
  strokes: [
    {
      id: 'stroke-1',
      tool: 'pen' as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  ],
};

describe('PaintingBoard', () => {
  it('renders a wrapper that fills its parent (100% x 100%)', () => {
    const { container } = render(<PaintingBoard />);
    // mock RN View 渲染为 <view> 标签，style 直接透传
    const wrapper = container.querySelector<HTMLElement>('view');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.style.width).toBe('100%');
    expect(wrapper?.style.height).toBe('100%');
    // 内部必须渲染出 DrawingSurface 的 svg
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('forwards testID to the underlying drawing surface host', () => {
    render(<PaintingBoard testID="painting-board" />);
    const host = screen.getByTestId('painting-board');
    expect(host.getAttribute('data-scale')).toBe('1');
  });

  it('enables virtual paper by default', () => {
    const { container } = render(<PaintingBoard />);
    expect(container.querySelector('[data-testid="virtual-paper-wrapper"]')).toBeTruthy();
  });

  it('disables virtual paper when virtualPaper={false}', () => {
    const { container } = render(<PaintingBoard virtualPaper={false} />);
    expect(container.querySelector('[data-testid="virtual-paper-wrapper"]')).toBeNull();
  });

  it('disables virtual paper when virtualPaper={{ enabled: false }}', () => {
    const { container } = render(<PaintingBoard virtualPaper={{ enabled: false }} />);
    expect(container.querySelector('[data-testid="virtual-paper-wrapper"]')).toBeNull();
  });

  it('keeps virtual paper enabled with custom options object', () => {
    const { container } = render(<PaintingBoard virtualPaper={{ minScale: 0.5, maxScale: 4 }} />);
    expect(container.querySelector('[data-testid="virtual-paper-wrapper"]')).toBeTruthy();
  });

  it('passes value through to the drawing surface', () => {
    render(<PaintingBoard testID="board" value={SINGLE_STROKE_VALUE} />);
    const host = screen.getByTestId('board');
    expect(host.getAttribute('data-stroke-count')).toBe('1');
  });

  it('passes other DrawingSurface props through (overflow)', () => {
    const { container } = render(<PaintingBoard overflow="visible" />);
    const svg = container.querySelector('svg');
    expect(svg?.style.overflow).toBe('visible');
  });

  it('exposes the DrawingSurface handle through ref', () => {
    const ref = createRef<PaintingBoardHandle>();
    render(<PaintingBoard ref={ref} />);
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.getHostSize).toBe('function');
    expect(typeof ref.current?.clearSelection).toBe('function');
    expect(typeof ref.current?.deleteSelectedStrokes).toBe('function');
    expect(typeof ref.current?.getSelectedStrokeIds).toBe('function');
  });
});
