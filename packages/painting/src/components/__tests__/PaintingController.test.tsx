import { fireEvent, render, screen } from '@testing-library/react';
import { PaintingController, type PaintingControllerData } from '../PaintingController';

describe('PaintingController', () => {
  it('writes a preset stroke color through the controlled data channel', () => {
    // Given: 普通绘制工具使用默认黑色，底栏处于可交互状态。
    const data: PaintingControllerData = {
      tool: 'pen',
      minimap: false,
      strokeColor: '#000000',
    };
    const onDataChange = jest.fn();
    render(<PaintingController data={data} onDataChange={onDataChange} tools={['pen']} />);

    // When: 用户打开颜色菜单并选择蓝色预设。
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-preset-1'));

    // Then: 新颜色沿完整 data 契约回写，其他字段保持不变。
    expect(onDataChange).toHaveBeenCalledWith({ ...data, strokeColor: '#2563eb' });
  });

  it('writes a custom stroke color through the controlled data channel', () => {
    // Given: 颜色菜单已打开。
    const data: PaintingControllerData = { tool: 'pen', minimap: false };
    const onDataChange = jest.fn();
    render(<PaintingController data={data} onDataChange={onDataChange} tools={['pen']} />);
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));

    // When: 用户通过原生颜色输入选择一个自定义颜色。
    fireEvent.change(screen.getByTestId('painting-board-stroke-color-custom-input'), {
      target: { value: '#14b8a6' },
    });

    // Then: 自定义颜色使用同一 data 回写通道。
    expect(onDataChange).toHaveBeenCalledWith({ ...data, strokeColor: '#14b8a6' });
  });

  it('hides the stroke color control while lasso is active', () => {
    // Given / When: 底栏当前激活套索工具。
    render(
      <PaintingController
        data={{ tool: 'lasso', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen', 'lasso']}
      />
    );

    // Then: 套索没有笔触颜色，底栏不显示颜色入口。
    expect(screen.queryByTestId('painting-board-stroke-color-btn')).toBeNull();
  });

  it('shows text color and font size controls without stroke-only controls', () => {
    // Given / When: 文字工具使用受控颜色与字号。
    render(
      <PaintingController
        data={{ tool: 'text', minimap: false, strokeColor: '#2563eb', fontSize: 20 }}
        onDataChange={jest.fn()}
        tools={['text']}
      />
    );

    // Then: 文字颜色和字号可直接调整，线宽与压感入口不出现。
    expect(screen.getByTestId('painting-board-stroke-color-btn')).toBeTruthy();
    expect(screen.getByTestId('painting-board-font-size-btn')).toBeTruthy();
    expect(screen.queryByTestId('painting-board-stroke-width-btn')).toBeNull();
    expect(screen.queryByTestId('painting-board-pressure-toggle')).toBeNull();
  });

  it('writes a text font size through the controlled data channel', () => {
    // Given: 文字工具当前字号为 24。
    const data: PaintingControllerData = { tool: 'text', minimap: false, fontSize: 24 };
    const onDataChange = jest.fn();
    render(<PaintingController data={data} onDataChange={onDataChange} tools={['text']} />);

    // When: 用户选择 32 px 字号。
    fireEvent.click(screen.getByTestId('painting-board-font-size-btn'));
    fireEvent.click(screen.getByTestId('painting-board-font-size-32'));

    // Then: 新字号通过统一 data 契约回写。
    expect(onDataChange).toHaveBeenCalledWith({ ...data, fontSize: 32 });
  });

  it('clears the shared selection when leaving the lasso tool', () => {
    // Given: 套索工具当前持有一个跨画板共享选区。
    const data: PaintingControllerData = {
      tool: 'lasso',
      minimap: false,
      selection: { boardId: 'board-b', strokeIds: ['stroke-1'] },
    };
    const onDataChange = jest.fn();
    render(<PaintingController data={data} onDataChange={onDataChange} tools={['pen', 'lasso']} />);

    // When: 用户离开套索工具。
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));

    // Then: 控制面主动清空选区，不依赖 owner 画板仍处于挂载状态。
    expect(onDataChange).toHaveBeenCalledWith({ ...data, tool: 'pen', selection: null });
  });

  it('discards a stale shared selection when entering the lasso tool', () => {
    // Given: 外部状态在非套索工具下意外保留了旧选区。
    const data: PaintingControllerData = {
      tool: 'pen',
      minimap: false,
      selection: { boardId: 'board-b', strokeIds: ['stroke-1'] },
    };
    const onDataChange = jest.fn();
    render(<PaintingController data={data} onDataChange={onDataChange} tools={['pen', 'lasso']} />);

    // When: 用户重新进入套索工具。
    fireEvent.click(screen.getByRole('button', { name: 'Lasso' }));

    // Then: 旧 owner 的选区不能在之后重新挂载时复活。
    expect(onDataChange).toHaveBeenCalledWith({ ...data, tool: 'lasso', selection: null });
  });

  it('hides reset/clear/more/minimap controls when multiBoard is true', () => {
    // Given: 多画板共享底栏模式开启，reset/clear/minimap 语义上只作用于单个画板，应隐藏。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        multiBoard
        onResetView={jest.fn()}
        onClearCanvas={jest.fn()}
      />
    );

    // When / Then: 四个「单画板语义」入口均不渲染。
    expect(screen.queryByTestId('painting-board-reset-view')).toBeNull();
    expect(screen.queryByTestId('painting-board-clear-canvas')).toBeNull();
    expect(screen.queryByTestId('painting-board-more-btn')).toBeNull();
    expect(screen.queryByTestId('painting-board-minimap-toggle')).toBeNull();
  });

  it('renders reset/clear/more controls by default and exposes MiniMap in the more menu', () => {
    // Given: 默认单画板模式（未传 multiBoard），传入 reset/clear 回调。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        onResetView={jest.fn()}
        onClearCanvas={jest.fn()}
      />
    );

    // When / Then: reset/clear/more 按钮渲染；点开 More 后出现 MiniMap 项。
    expect(screen.queryByTestId('painting-board-reset-view')).not.toBeNull();
    expect(screen.queryByTestId('painting-board-clear-canvas')).not.toBeNull();
    expect(screen.queryByTestId('painting-board-more-btn')).not.toBeNull();
    fireEvent.click(screen.getByTestId('painting-board-more-btn'));
    expect(screen.queryByTestId('painting-board-minimap-toggle')).not.toBeNull();
  });

  it('renders undo and redo first and forwards enabled history actions', () => {
    // Given: 历史栈已有可撤销和可恢复的画布操作。
    const undo = jest.fn();
    const redo = jest.fn();
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        history={{ canUndo: true, canRedo: true, undo, redo }}
      />
    );

    // When: 用户点击底栏最左侧的撤销和恢复按钮。
    const toolbar = screen.getByTestId('painting-board-toolbar');
    const buttons = toolbar.querySelectorAll('button');
    fireEvent.click(screen.getByTestId('painting-board-undo'));
    fireEvent.click(screen.getByTestId('painting-board-redo'));

    // Then: 两个入口排在工具按钮之前，并调用对应历史命令。
    expect(buttons[0]).toBe(screen.getByTestId('painting-board-undo'));
    expect(buttons[1]).toBe(screen.getByTestId('painting-board-redo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable undo and redo actions', () => {
    // Given / When: 历史栈没有过去或未来状态。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        history={{ canUndo: false, canRedo: false, undo: jest.fn(), redo: jest.fn() }}
      />
    );

    // Then: 按钮保留可发现性，但不可操作。
    expect(screen.getByTestId('painting-board-undo')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('painting-board-redo')).toHaveProperty('disabled', true);
  });

  // ===== Change A: relative prop =====
  it('renders the toolbar with position: fixed by default and position: absolute when relative is true', () => {
    // Given / When: 默认不传 relative —— Popover 以 position: fixed 吸附视口底部。
    const { unmount } = render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
      />
    );
    // Then: 工具栏根 div 的 inline style 为 position: fixed。
    expect(screen.getByTestId('painting-board-toolbar').style.position).toBe('fixed');
    unmount();

    // When: 传入 relative={true} —— Popover 改为 position: absolute 相对最近定位祖先。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        relative
      />
    );
    // Then: 工具栏根 div 的 inline style 变为 position: absolute。
    expect(screen.getByTestId('painting-board-toolbar').style.position).toBe('absolute');
  });

  // ===== Change E: compact 模式收纳内联按钮到 More 菜单 =====
  it('hides inline pressure/stylus/clear and surfaces them in the More menu in compact mode', () => {
    // Given: compact 模式（屏幕宽度 < 768px），覆盖 jest.setup.js 的默认 matchMedia。
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    try {
      render(
        <PaintingController
          data={{ tool: 'pen', minimap: false }}
          onDataChange={jest.fn()}
          tools={['pen']}
          onClearCanvas={jest.fn()}
        />
      );

      // Then: 内联的压感 / 手写笔 / 清空按钮在 compact 模式下隐藏。
      expect(screen.queryByTestId('painting-board-pressure-toggle')).toBeNull();
      expect(screen.queryByTestId('painting-board-stylus-toggle')).toBeNull();
      expect(screen.queryByTestId('painting-board-clear-canvas')).toBeNull();

      // When: 打开 More 菜单（compact 模式下 More 按钮始终展示）。
      fireEvent.click(screen.getByTestId('painting-board-more-btn'));

      // Then: 压感 / 手写笔 / 清空收纳进 More 菜单。
      expect(screen.queryByTestId('painting-board-more-pressure')).not.toBeNull();
      expect(screen.queryByTestId('painting-board-more-stylus')).not.toBeNull();
      expect(screen.queryByTestId('painting-board-more-clear-canvas')).not.toBeNull();
    } finally {
      // 恢复默认 matchMedia，避免影响后续测试。
      window.matchMedia = originalMatchMedia;
    }
  });

  // ===== Change E: compact + multiBoard =====
  it('shows pressure and stylus but not minimap or clear in compact + multiBoard mode', () => {
    // Given: compact + multiBoard 模式 —— 压感/手写笔是全局设置，保留；
    //        MiniMap/清空语义只作用于单画板，隐藏。
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    try {
      render(
        <PaintingController
          data={{ tool: 'pen', minimap: false }}
          onDataChange={jest.fn()}
          tools={['pen']}
          multiBoard
          onClearCanvas={jest.fn()}
        />
      );

      // When: 打开 More 菜单（compact 模式下即使 multiBoard 也展示 More 按钮）。
      fireEvent.click(screen.getByTestId('painting-board-more-btn'));

      // Then: 压感 / 手写笔保留；MiniMap / 清空隐藏。
      expect(screen.queryByTestId('painting-board-more-pressure')).not.toBeNull();
      expect(screen.queryByTestId('painting-board-more-stylus')).not.toBeNull();
      expect(screen.queryByTestId('painting-board-minimap-toggle')).toBeNull();
      expect(screen.queryByTestId('painting-board-more-clear-canvas')).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  // ===== Changes B+C: compact 工具菜单 accent 高亮 + 图标/占位 =====
  it('highlights the active tool with accent background and renders icons/spacers in the compact tools menu', () => {
    // Given: compact 模式，当前工具为 pen（有图标），工具列表含 polygon（无图标）。
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    try {
      render(
        <PaintingController
          data={{ tool: 'pen', minimap: false }}
          onDataChange={jest.fn()}
          tools={['pen', 'polygon']}
        />
      );

      // When: 打开 compact 工具菜单。
      fireEvent.click(screen.getByTestId('painting-board-compact-tool-btn'));

      // Then: 激活工具 pen 的 MenuItem 有 accent 背景高亮。
      const activeItem = screen.getByTestId('painting-board-compact-tool-pen');
      expect(activeItem.getAttribute('style') ?? '').toContain('var(--hn-color-accent)');

      // 非激活工具 polygon 没有 accent 背景高亮。
      const inactiveItem = screen.getByTestId('painting-board-compact-tool-polygon');
      expect(inactiveItem.getAttribute('style') ?? '').not.toContain('var(--hn-color-accent)');

      // pen 有图标（Icon 渲染为 svg 元素）。
      expect(activeItem.querySelector('svg')).not.toBeNull();

      // polygon 无图标，渲染占位 span（aria-hidden + width: 14）。
      const spacer = inactiveItem.querySelector('span[aria-hidden="true"]');
      expect(spacer).not.toBeNull();
      expect(spacer?.getAttribute('style') ?? '').toContain('width: 14px');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
