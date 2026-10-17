import { fireEvent, render, screen } from '@testing-library/react';
import { VirtualPaperSurfaceFrame } from '../VirtualPaperSurfaceFrame';

/**
 * VirtualPaperSurfaceFrame 的可观测 DOM 契约测试。
 * 这些断言锁定内部 Frame 对 DrawingSurface 暴露的单矩阵 DOM 结构。
 */
describe('VirtualPaperSurfaceFrame (display-only)', () => {
  it('renders children without the viewport frame when disabled', () => {
    // Given: 虚拟纸模式未启用。
    const { container } = render(
      <VirtualPaperSurfaceFrame enabled={false} viewport={{ scale: 2, tx: 10, ty: 20 }}>
        <svg data-testid="content" />
      </VirtualPaperSurfaceFrame>
    );

    // Then: 不包裹任何视口容器，子节点直出。
    expect(screen.getByTestId('content')).toBeTruthy();
    expect(container.querySelector('[data-testid="virtual-paper-wrapper"]')).toBeNull();
    expect(container.querySelector('[data-testid="virtual-paper-container"]')).toBeNull();
  });

  it('renders the contracted wrapper and container DOM when enabled', () => {
    // Given: 虚拟纸模式启用。
    render(
      <VirtualPaperSurfaceFrame enabled={true} viewport={{ scale: 1, tx: 0, ty: 0 }}>
        <svg data-testid="content" />
      </VirtualPaperSurfaceFrame>
    );

    // Then: wrapper / container 的 testid、class 与基础布局样式符合契约。
    const wrapper = screen.getByTestId('virtual-paper-wrapper');
    const container = screen.getByTestId('virtual-paper-container');

    expect(wrapper.className).toBe('virtual-paper-wrapper');
    expect(wrapper.style.position).toBe('relative');
    expect(wrapper.style.overflow).toBe('hidden');
    expect(wrapper.style.width).toBe('100%');
    expect(wrapper.style.height).toBe('100%');

    expect(container.className).toBe('virtual-paper-container');
    expect(container.style.position).toBe('absolute');
    expect(container.style.transformOrigin).toBe('0 0');
    expect(container.style.touchAction).toBe('none');
    expect(container.style.userSelect).toBe('none');

    // Then: 子节点位于 container 内，视觉结构保持不变。
    expect(container.contains(screen.getByTestId('content'))).toBe(true);
    expect(wrapper.contains(container)).toBe(true);
  });

  it('applies a single exact translate3d/scale transform from the viewport', () => {
    // Given: 一个含小数比例与平移的视口。
    render(
      <VirtualPaperSurfaceFrame enabled={true} viewport={{ scale: 1.5, tx: -12.5, ty: 40 }}>
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: container 的 transform 恰好是单次 translate3d + scale。
    const container = screen.getByTestId('virtual-paper-container');
    expect(container.style.transform).toBe('translate3d(-12.5px, 40px, 0) scale(1.5)');
  });

  it('falls back to safe finite values instead of emitting invalid CSS', () => {
    // Given: 视口包含 NaN / Infinity 等非有限值。
    render(
      <VirtualPaperSurfaceFrame
        enabled={true}
        viewport={{ scale: Number.NaN, tx: Number.POSITIVE_INFINITY, ty: Number.NaN }}
      >
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: 回退到安全有限值，绝不生成无效 CSS。
    const container = screen.getByTestId('virtual-paper-container');
    expect(container.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
    expect(container.style.transform).not.toMatch(/NaN|Infinity/);
  });

  it('clamps extreme scale into the supported finite range', () => {
    // Given: 缩放为 Infinity（非有限）以及超出上限的有限值。
    const { rerender } = render(
      <VirtualPaperSurfaceFrame
        enabled={true}
        viewport={{ scale: Number.POSITIVE_INFINITY, tx: 0, ty: 0 }}
      >
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: Infinity 先回退为默认缩放 1，transform 仍然合法。
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(0px, 0px, 0) scale(1)'
    );

    // When: 传入低于下限的有限缩放。
    rerender(
      <VirtualPaperSurfaceFrame enabled={true} viewport={{ scale: 0.01, tx: 0, ty: 0 }}>
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: 收敛到最小缩放。
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(0px, 0px, 0) scale(0.25)'
    );

    // When: 运行时 JS 调用方传入缺失字段（undefined）。
    rerender(
      <VirtualPaperSurfaceFrame
        enabled={true}
        viewport={{ scale: undefined, tx: null, ty: '2' } as unknown as {
          scale: number;
          tx: number;
          ty: number;
        }}
      >
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: 全部安全回退，不生成无效 CSS。
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(0px, 0px, 0) scale(1)'
    );
  });

  it('applies containerStyle but never lets it break the transform contract', () => {
    // Given: 调用方传入尺寸/溢出样式，并尝试覆盖 transform 与 transform-origin。
    render(
      <VirtualPaperSurfaceFrame
        enabled={true}
        viewport={{ scale: 2, tx: 5, ty: 6 }}
        containerStyle={{
          width: '100%',
          height: '100%',
          overflow: 'visible',
          transform: 'scale(99)',
          transformOrigin: '50% 50%',
        }}
      >
        <svg />
      </VirtualPaperSurfaceFrame>
    );

    // Then: 附加样式生效，但 transform 契约始终由视口决定。
    const container = screen.getByTestId('virtual-paper-container');
    expect(container.style.width).toBe('100%');
    expect(container.style.height).toBe('100%');
    expect(container.style.overflow).toBe('visible');
    expect(container.style.transform).toBe('translate3d(5px, 6px, 0) scale(2)');
    expect(container.style.transformOrigin).toBe('0 0');
  });

  it('creates no listeners and never invokes onViewportChange', () => {
    // Given: 启用的 Frame 携带着兼容签名保留的回调。
    const onViewportChange = jest.fn();
    render(
      <VirtualPaperSurfaceFrame
        enabled={true}
        viewport={{ scale: 1, tx: 0, ty: 0 }}
        options={{ enabledInteractions: ['mouseWheelCtrlZoom', 'touchTwoFingerZoom'] }}
        onViewportChange={onViewportChange}
      >
        <svg />
      </VirtualPaperSurfaceFrame>
    );
    const wrapper = screen.getByTestId('virtual-paper-wrapper');

    // When: 在 wrapper 上派发滚轮与指针手势事件。
    fireEvent.wheel(wrapper, { deltaY: -100, ctrlKey: true });
    fireEvent.pointerDown(wrapper, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(wrapper, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 40 });
    fireEvent.pointerUp(wrapper, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 40 });

    // Then: 纯展示 Frame 不响应任何手势，回调从未被调用，视口 transform 不变。
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(0px, 0px, 0) scale(1)'
    );
  });
});
