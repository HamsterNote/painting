import {
  Minimap as MinimapFromIndex,
  normalizeViewport as normalizeViewportFromIndex,
} from '@hamster-note/painting';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { DrawingStroke, DrawingValue } from '../components/DrawingSurface';
import { Minimap } from '../components/Minimap';
import type { DrawingViewport } from '../viewport';

// --- 测试用的辅助工厂函数 ---

/** 创建一条 pen stroke */
function makePenStroke(id: string, points: Array<{ x: number; y: number }>): DrawingStroke {
  return {
    id,
    tool: 'pen' as const,
    points,
  };
}

/** 创建一条 rect stroke */
function makeRectStroke(id: string, points: Array<{ x: number; y: number }>): DrawingStroke {
  return {
    id,
    tool: 'rect' as const,
    points,
  };
}

/** 创建测试用 DrawingValue */
function makeValue(strokes: DrawingStroke[]): DrawingValue {
  return { strokes };
}

// --- 测试用例 ---

describe('Minimap', () => {
  describe('渲染', () => {
    it('空笔画时渲染占位文本', () => {
      render(<Minimap value={makeValue([])} />);
      expect(screen.getByTestId('minimap')).toBeTruthy();
      expect(screen.getByTestId('minimap-empty-text')).toBeTruthy();
    });

    it('有笔画时渲染 SVG 内容', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]),
      ]);
      const { container } = render(<Minimap value={value} />);

      // SVG 应存在
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // 不应有占位文本
      expect(screen.queryByTestId('minimap-empty-text')).toBeNull();

      // 应渲染了 stroke（line 或 path 元素）
      const shapes = container.querySelectorAll('line, path, rect, ellipse, polygon');
      expect(shapes.length).toBeGreaterThan(0);
    });

    it('从 index 导出与从相对路径导入行为一致', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 50, y: 50 }]),
      ]);

      const { container: indexContainer } = render(<MinimapFromIndex value={value} />);
      const { container: relContainer } = render(<Minimap value={value} />);

      const indexSvg = indexContainer.querySelector('svg');
      const relSvg = relContainer.querySelector('svg');

      expect(indexSvg).toBeTruthy();
      expect(relSvg).toBeTruthy();
      // 两者都应渲染内容（非空占位）
      expect(indexContainer.querySelector('line, path, rect, ellipse, polygon')).toBeTruthy();
      expect(relContainer.querySelector('line, path, rect, ellipse, polygon')).toBeTruthy();
    });

    it('从包入口导出视口归一化函数', () => {
      expect(
        normalizeViewportFromIndex({
          scale: 0,
          tx: Number.NaN,
          ty: Number.POSITIVE_INFINITY,
        }),
      ).toEqual({ scale: 0.25, tx: 0, ty: 0 });
    });

    it('使用自定义宽高', () => {
      const { container } = render(
        <Minimap value={makeValue([])} width={300} height={200} />,
      );
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('300');
      expect(svg?.getAttribute('height')).toBe('200');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 300 200');
    });

    it('使用自定义 testId', () => {
      render(<Minimap value={makeValue([])} testId="custom-minimap" />);
      expect(screen.getByTestId('custom-minimap')).toBeTruthy();
    });

    it('应用自定义 className 和 style', () => {
      const { container } = render(
        <Minimap
          value={makeValue([])}
          className="my-minimap"
          style={{ position: 'absolute' }}
        />,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('my-minimap');
      expect(wrapper.style.position).toBe('absolute');
    });
  });

  describe('内容适配', () => {
    it('多条 stroke 的内容被正确缩放到 minimap 范围内', () => {
      // 创建一个跨度很大的画布内容（0,0 到 1000,500）
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
        makePenStroke('s2', [{ x: 0, y: 0 }, { x: 0, y: 500 }]),
      ]);

      const { container } = render(
        <Minimap value={value} width={200} height={100} padding={10} />,
      );

      // 所有渲染的图形应在 viewBox 范围内
      const shapes = container.querySelectorAll('line, path, rect, ellipse, polygon');
      expect(shapes.length).toBeGreaterThan(0);

      // 检查 transform group 存在
      const g = container.querySelector('svg > g');
      expect(g).toBeTruthy();
      // transform 应包含 scale（非 1，因为内容比 minimap 大）
      const transform = g?.getAttribute('transform') ?? '';
      expect(transform).toContain('scale');
    });

    it('rect stroke 正确渲染', () => {
      const value = makeValue([
        makeRectStroke('r1', [{ x: 10, y: 10 }, { x: 60, y: 40 }]),
      ]);

      const { container } = render(<Minimap value={value} />);
      const rects = container.querySelectorAll('rect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
    });

    it('过滤掉含无效坐标的点后仍渲染有效路径', () => {
      const value = makeValue([
        makePenStroke('s1', [
          { x: NaN, y: 0 },
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ]),
      ]);

      const { container } = render(<Minimap value={value} />);
      const path = container.querySelector('path');
      expect(path?.getAttribute('d')).toContain('M 0 0');
      expect(path?.getAttribute('d')).not.toContain('NaN');
    });
  });

  describe('视口指示框', () => {
    it('提供 viewport 和 containerSize 时渲染视口框', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 200, y: 200 }]),
      ]);
      const viewport: DrawingViewport = { scale: 1, tx: 0, ty: 0 };
      const containerSize = { width: 400, height: 300 };

      render(
        <Minimap
          value={value}
          viewport={viewport}
          containerSize={containerSize}
        />,
      );

      const viewportRect = screen.queryByTestId('minimap-viewport-rect');
      expect(viewportRect).toBeTruthy();
    });

    it('未提供 viewport 时不渲染视口框', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]),
      ]);

      render(<Minimap value={value} />);
      expect(screen.queryByTestId('minimap-viewport-rect')).toBeNull();
    });

    it('未提供 containerSize 时不渲染视口框', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]),
      ]);
      const viewport: DrawingViewport = { scale: 1, tx: 0, ty: 0 };

      render(<Minimap value={value} viewport={viewport} />);
      expect(screen.queryByTestId('minimap-viewport-rect')).toBeNull();
    });

    it('视口框位置随 viewport 变化', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 400, y: 400 }]),
      ]);
      const containerSize = { width: 400, height: 400 };

      // 视口在左上角
      const { rerender } = render(
        <Minimap
          value={value}
          viewport={{ scale: 1, tx: 0, ty: 0 }}
          containerSize={containerSize}
          width={200}
          height={200}
          padding={10}
        />,
      );

      const rect1 = screen.getByTestId('minimap-viewport-rect');
      const x1 = parseFloat(rect1.getAttribute('x') ?? '0');

      // 视口向右下平移
      rerender(
        <Minimap
          value={value}
          viewport={{ scale: 1, tx: -100, ty: -100 }}
          containerSize={containerSize}
          width={200}
          height={200}
          padding={10}
        />,
      );

      const rect2 = screen.getByTestId('minimap-viewport-rect');
      const x2 = parseFloat(rect2.getAttribute('x') ?? '0');

      // 平移后视口框 X 坐标应改变
      expect(x2).not.toBe(x1);
    });

    it('视口框使用自定义样式', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]),
      ]);

      render(
        <Minimap
          value={value}
          viewport={{ scale: 1, tx: 0, ty: 0 }}
          containerSize={{ width: 200, height: 200 }}
          viewportStroke="#ff0000"
          viewportStrokeWidth={3}
          viewportFill="rgba(255,0,0,0.2)"
          viewportRx={5}
        />,
      );

      const rect = screen.getByTestId('minimap-viewport-rect');
      expect(rect.getAttribute('stroke')).toBe('#ff0000');
      expect(rect.getAttribute('stroke-width')).toBe('3');
      expect(rect.getAttribute('fill')).toBe('rgba(255,0,0,0.2)');
      expect(rect.getAttribute('rx')).toBe('5');
    });
  });

  describe('点击平移', () => {
    it('点击时调用 onViewportChange', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 200, y: 200 }]),
      ]);
      const viewport: DrawingViewport = { scale: 1, tx: 0, ty: 0 };
      const containerSize = { width: 400, height: 300 };

      const onViewportChange = jest.fn();

      const { container } = render(
        <Minimap
          value={value}
          viewport={viewport}
          containerSize={containerSize}
          onViewportChange={onViewportChange}
          width={200}
          height={100}
          padding={10}
        />,
      );

      const svg = container.querySelector('svg');
      if (!svg) {
        throw new Error('SVG not rendered');
      }

      const pointerEvent = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(pointerEvent, {
        clientX: 100,
        clientY: 50,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        isPrimary: true,
      });

      act(() => {
        svg.dispatchEvent(pointerEvent);
      });

      expect(onViewportChange).toHaveBeenCalledTimes(1);

      const newViewport = onViewportChange.mock.calls[0][0] as DrawingViewport;
      expect(newViewport.scale).toBe(1);
      expect(Number.isFinite(newViewport.tx)).toBe(true);
      expect(Number.isFinite(newViewport.ty)).toBe(true);
    });

    it('忽略非主按钮和非主指针', () => {
      const onViewportChange = jest.fn();
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 200, y: 200 }]),
      ]);
      render(
        <Minimap
          value={value}
          viewport={{ scale: 1, tx: 0, ty: 0 }}
          containerSize={{ width: 400, height: 300 }}
          onViewportChange={onViewportChange}
        />,
      );
      const svg = screen.getByTestId('minimap-svg');

      fireEvent.pointerDown(svg, { button: 2, isPrimary: true, clientX: 50, clientY: 50 });
      fireEvent.pointerDown(svg, { button: 0, isPrimary: false, clientX: 50, clientY: 50 });

      expect(onViewportChange).not.toHaveBeenCalled();
    });

    it('归一化无效视口后再计算点击平移', () => {
      const onViewportChange = jest.fn();
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 200, y: 200 }]),
      ]);
      render(
        <Minimap
          value={value}
          viewport={{ scale: 0, tx: Number.NaN, ty: Number.POSITIVE_INFINITY }}
          containerSize={{ width: 400, height: 300 }}
          onViewportChange={onViewportChange}
          width={200}
          height={100}
        />,
      );

      const pointerEvent = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(pointerEvent, {
        button: 0,
        isPrimary: true,
        clientX: 100,
        clientY: 50,
      });
      act(() => {
        screen.getByTestId('minimap-svg').dispatchEvent(pointerEvent);
      });

      const nextViewport = onViewportChange.mock.calls[0]?.[0] as DrawingViewport | undefined;
      expect(nextViewport).toEqual({ scale: 0.25, tx: 175, ty: 125 });
    });

    it('未提供 onViewportChange 时点击不报错', () => {
      const value = makeValue([
        makePenStroke('s1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]),
      ]);

      const { container } = render(
        <Minimap
          value={value}
          viewport={{ scale: 1, tx: 0, ty: 0 }}
          containerSize={{ width: 200, height: 200 }}
          width={100}
          height={100}
        />,
      );

      const svg = container.querySelector('svg');
      if (!svg) {
        throw new Error('SVG not rendered');
      }

      // 不应抛出异常
      expect(() => {
        act(() => {
          fireEvent.pointerDown(svg, { clientX: 50, clientY: 50 });
        });
      }).not.toThrow();
    });

    it('无笔画时点击不调用 onViewportChange', () => {
      const onViewportChange = jest.fn();

      const { container } = render(
        <Minimap
          value={makeValue([])}
          viewport={{ scale: 1, tx: 0, ty: 0 }}
          containerSize={{ width: 200, height: 200 }}
          onViewportChange={onViewportChange}
        />,
      );

      const svg = container.querySelector('svg');
      if (!svg) {
        throw new Error('SVG not rendered');
      }
      act(() => {
        fireEvent.pointerDown(svg, { clientX: 50, clientY: 50 });
      });

      expect(onViewportChange).not.toHaveBeenCalled();
    });
  });

  describe('背景和样式', () => {
    it('应用自定义背景色', () => {
      const { container } = render(
        <Minimap value={makeValue([])} background="#f0f0f0" />,
      );
      const svg = container.querySelector('svg');
      // jsdom 将 #f0f0f0 规范化为 rgb(240, 240, 240)
      expect(svg?.style.background).toBe('rgb(240, 240, 240)');
    });

    it('有 onViewportChange 时 cursor 为 pointer', () => {
      const { container } = render(
        <Minimap
          value={makeValue([])}
          onViewportChange={jest.fn()}
        />,
      );
      const svg = container.querySelector('svg');
      expect(svg?.style.cursor).toBe('pointer');
    });

    it('无 onViewportChange 时 cursor 为 default', () => {
      const { container } = render(
        <Minimap value={makeValue([])} />,
      );
      const svg = container.querySelector('svg');
      expect(svg?.style.cursor).toBe('default');
    });
  });
});
