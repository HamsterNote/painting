import { type CSSProperties, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover, type PopoverTheme } from '@hamster-note/components';
import {
  DrawingSurface,
  type DrawingSelectionOverlay,
  type DrawingStroke,
  type DrawingSurfaceHandle,
  type DrawingSurfaceProps,
  type DrawingTool,
  type DrawingValue,
} from './DrawingSurface';
import { Minimap } from './Minimap';
import {
  PAINTING_BOARD_DEFAULT_TOOLS,
  PaintingController,
  type PaintingControllerData,
} from './PaintingController';
import { DEFAULT_DRAWING_VIEWPORT, type DrawingViewport } from '../viewport';

/**
 * PaintingBoard — DrawingSurface 的产品化封装
 * ───────────────────────────────────────────────────────────────────────────
 * 在 DrawingSurface 之上叠加工具栏。工具栏 UI 已抽离为独立的
 * `PaintingController`（完全受控，通过 `data` / `onDataChange` 通信）：
 * PaintingBoard 默认在内部渲染一个 PaintingController 并自行托管 data；
 * 需要「一个底部栏控制多个画板」时，给每个 PaintingBoard 传 `toolbar={false}`，
 * 外部自行渲染 PaintingController 并把同一份 data 分发给所有画板即可。
 *
 * ⚠️ Web-only：Popover 依赖 react-dom（createPortal），本组件不支持
 * react-native 原生端。Web 消费方需在应用入口手动引入一次样式：
 *
 * ```ts
 * import '@hamster-note/components/styles.css';
 * ```
 *
 * Tool / Minimap 均支持受控（`tool` + `onToolChange`、`minimap` + `onMinimapChange`）
 * 与非受控（`defaultTool`）两种用法，与 DrawingSurface 的 value/defaultValue
 * 契约保持一致。
 */

// 底部栏默认工具集已迁移到 PaintingController；此处 re-export 保持既有导入路径不破。
export { PAINTING_BOARD_DEFAULT_TOOLS } from './PaintingController';

/** 底部工具栏配置；传 `false` 可整体隐藏工具栏 */
export interface PaintingBoardToolbarOptions {
  /** 展示哪些工具及顺序；默认 PAINTING_BOARD_DEFAULT_TOOLS */
  readonly tools?: readonly DrawingTool[];
  /** Popover 主题，默认 'dark' */
  readonly theme?: PopoverTheme;
  /** 工具栏吸附的视口边缘，默认 'bottom'（底部栏） */
  readonly edge?: PopoverEdge;
  /** 距吸附边缘的偏移（px），默认 16 */
  readonly edgeOffset?: number;
  /** 是否在图标旁展示文字标签，默认 false */
  readonly showLabels?: boolean;
}

/** Popover 吸附边缘类型，供 ToolbarOptions 使用 */
type PopoverEdge = 'top' | 'bottom' | 'left' | 'right';

/** 选区 Popover 与选区包围盒的间距（px） */
const POPOVER_PLACEMENT_GAP = 8;
/** 选区顶部距宿主顶边小于该值时，Popover 翻转到选区下方展示 */
const POPOVER_PLACEMENT_MIN_TOP = 56;

/** 套索选区 Popover 配置；传 `false` 可整体隐藏 */
export interface PaintingBoardSelectionPopoverOptions {
  /** Popover 主题，默认 'dark' */
  readonly theme?: PopoverTheme;
}

export interface PaintingBoardProps extends Omit<DrawingSurfaceProps, 'tool'> {
  /** 受控工具。传入后内部状态失效，切换仅通过 onToolChange 通知 */
  readonly tool?: DrawingTool;
  /** 非受控初始工具，默认 'pen' */
  readonly defaultTool?: DrawingTool;
  /** 工具切换回调（受控/非受控均触发） */
  readonly onToolChange?: (tool: DrawingTool) => void;
  /** 受控 Minimap 可见性。传入后内部状态失效，切换仅通过 onMinimapVisibleChange 通知。
      命名为 minimapVisible 以区分 DrawingSurfaceProps 自带的 `minimap`（surface 内置小地图配置） */
  readonly minimapVisible?: boolean;
  /** Minimap 可见性切换回调（受控/非受控均触发） */
  readonly onMinimapVisibleChange?: (visible: boolean) => void;
  /** 底部工具栏配置；`false` 隐藏。默认展示全部工具的深色底部栏 */
  readonly toolbar?: false | PaintingBoardToolbarOptions;
  /** 套索选区 Popover 配置；`false` 隐藏。默认展示含删除按钮的深色浮层 */
  readonly selectionPopover?: false | PaintingBoardSelectionPopoverOptions;
  /** 外层容器样式（DrawingSurface 自身不接收 style，作用于 PaintingBoard 容器） */
  readonly style?: CSSProperties;
}

export const PaintingBoard = forwardRef<DrawingSurfaceHandle, PaintingBoardProps>(
  function PaintingBoard(
    {
      tool: toolProp,
      defaultTool = 'pen',
      onToolChange,
      minimapVisible: minimapVisibleProp,
      onMinimapVisibleChange,
      toolbar,
      selectionPopover,
      onSelectionOverlayChange,
      style,
      virtualPaper = true,
      value: valueProp,
      onChange: onChangeProp,
      viewport: viewportProp,
      defaultViewport,
      onViewportChange: onViewportChangeProp,
      ...surfaceProps
    },
    ref
  ) {
    // ===== 受控 / 非受控 tool 状态 =====
    const [innerTool, setInnerTool] = useState<DrawingTool>(defaultTool);
    const activeTool = toolProp ?? innerTool;

    // ===== 受控 / 非受控 Minimap 可见性状态 =====
    const [innerMinimapVisible, setInnerMinimapVisible] = useState(false);
    const showMinimap = minimapVisibleProp ?? innerMinimapVisible;

    const toolbarOptions = useMemo<PaintingBoardToolbarOptions | null>(() => {
      if (toolbar === false) return null;
      return toolbar ?? {};
    }, [toolbar]);

    const selectionPopoverOptions = useMemo<PaintingBoardSelectionPopoverOptions | null>(() => {
      if (selectionPopover === false) return null;
      return selectionPopover ?? {};
    }, [selectionPopover]);

    const tools = toolbarOptions?.tools ?? PAINTING_BOARD_DEFAULT_TOOLS;

    // ===== PaintingController 受控数据 =====
    // 把 tool / minimap 聚合成 PaintingController 需要的 data；
    // PaintingBoard 内部渲染工具栏时即为「受控消费方」。
    const controllerData = useMemo<PaintingControllerData>(
      () => ({ tool: activeTool, minimap: showMinimap }),
      [activeTool, showMinimap]
    );

    // PaintingController 回写 data：拆解字段，分别走 tool / minimap 的
    // 受控 / 非受控同步逻辑，与直接操作按钮时的行为完全一致。
    const handleControllerDataChange = useCallback(
      (next: PaintingControllerData) => {
        if (next.tool !== activeTool) {
          // 非受控时同步内部状态；受控时完全交由父组件
          if (toolProp === undefined) {
            setInnerTool(next.tool);
          }
          onToolChange?.(next.tool);
        }
        if (next.minimap !== showMinimap) {
          if (minimapVisibleProp === undefined) {
            setInnerMinimapVisible(next.minimap);
          }
          onMinimapVisibleChange?.(next.minimap);
        }
      },
      [activeTool, toolProp, onToolChange, showMinimap, minimapVisibleProp, onMinimapVisibleChange]
    );

    // 内部持有 DrawingSurface handle 以便触发命令式操作（如删除选区），
    // 同时把外部 forwarded ref 串联进来，保证消费方仍能拿到 handle。
    const surfaceRef = useRef<DrawingSurfaceHandle | null>(null);
    const setSurfaceRef = useCallback(
      (handle: DrawingSurfaceHandle | null) => {
        surfaceRef.current = handle;
        if (typeof ref === 'function') {
          ref(handle);
        } else if (ref) {
          ref.current = handle;
        }
      },
      [ref]
    );

    // 选区包围盒（宿主本地屏幕坐标）。DrawingSurface 在选区出现/移动/缩放/
    // 视口变化时回调；无选区时回调 null，Popover 随之消失。
    const [selectionOverlay, setSelectionOverlay] = useState<DrawingSelectionOverlay | null>(null);
    const handleSelectionOverlayChange = useCallback(
      (overlay: DrawingSelectionOverlay | null) => {
        setSelectionOverlay(overlay);
        onSelectionOverlayChange?.(overlay);
      },
      [onSelectionOverlayChange]
    );

    const handleDeleteSelection = useCallback(() => {
      surfaceRef.current?.deleteSelectedStrokes();
    }, []);

    // 追踪 strokes：受控时使用 valueProp，非受控时通过 onChange 同步
    const [internalStrokes, setInternalStrokes] = useState<DrawingStroke[]>(
      valueProp?.strokes ?? []
    );
    const strokes = useMemo(
      () => valueProp?.strokes ?? internalStrokes,
      [valueProp?.strokes, internalStrokes]
    );

    // 追踪 viewport：受控时使用 viewportProp，非受控时通过 onViewportChange 同步。
    // 初始值同样尊重 defaultViewport，保证与 DrawingSurface 的非受控初始值一致。
    const [internalViewport, setInternalViewport] = useState<DrawingViewport>(
      viewportProp ?? defaultViewport ?? DEFAULT_DRAWING_VIEWPORT
    );
    const currentViewport = useMemo(
      () => viewportProp ?? internalViewport,
      [viewportProp, internalViewport]
    );

    // 拦截 onChange，同步内部 strokes 状态
    const handleChange = useCallback(
      (nextValue: DrawingValue) => {
        setInternalStrokes(nextValue.strokes);
        onChangeProp?.(nextValue);
      },
      [onChangeProp]
    );

    // 拦截 onViewportChange，同步内部 viewport 状态
    const handleViewportChange = useCallback(
      (nextViewport: DrawingViewport) => {
        setInternalViewport(nextViewport);
        onViewportChangeProp?.(nextViewport);
      },
      [onViewportChangeProp]
    );

    // 画布区域宿主尺寸，通过 ResizeObserver 追踪（供 Minimap 使用）
    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const [hostSize, setHostSize] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });
    useEffect(() => {
      const el = canvasWrapperRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) {
          setHostSize({ width: rect.width, height: rect.height });
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    return (
      <div
        data-testid="painting-board"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          ...style,
        }}
      >
        {/* 画布区域占满剩余空间。设为定位上下文，选区 Popover 以此为锚做绝对定位 */}
        <div ref={canvasWrapperRef} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
          <DrawingSurface
            ref={setSurfaceRef}
            tool={activeTool}
            virtualPaper={virtualPaper}
            value={valueProp}
            onChange={handleChange}
            // 始终回传解析后的 viewport（而非仅受控时的 viewportProp），
            // 形成闭环：Minimap 拖拽 → handleViewportChange → setInternalViewport → 此处回传，
            // 让 DrawingSurface 真正把 Minimap 的变更应用到画板上。
            viewport={currentViewport}
            defaultViewport={defaultViewport}
            onViewportChange={handleViewportChange}
            onSelectionOverlayChange={handleSelectionOverlayChange}
            {...surfaceProps}
          />
          {selectionPopoverOptions && selectionOverlay && (
            <Popover
              data-testid="lasso-selection-popover"
              data-interactive
              theme={selectionPopoverOptions.theme ?? 'dark'}
              style={{
                position: 'absolute',
                left: selectionOverlay.x + selectionOverlay.width,
                top:
                  selectionOverlay.y >= POPOVER_PLACEMENT_MIN_TOP
                    ? selectionOverlay.y - POPOVER_PLACEMENT_GAP
                    : selectionOverlay.y + selectionOverlay.height + POPOVER_PLACEMENT_GAP,
                transform:
                  selectionOverlay.y >= POPOVER_PLACEMENT_MIN_TOP
                    ? 'translate(-100%, -100%)'
                    : 'translateX(-100%)',
                zIndex: 20,
                // Popover 锚定在选区右上角，其容器区域可能盖住选框正上方的旋转手柄，
                // 把 pointerdown 拦在 DrawingSurface host 之外，导致旋转无法启动。
                // 容器整体穿透，仅 Delete 按钮恢复可点，事件可直达手柄。
                pointerEvents: 'none',
              }}
            >
              <Button
                type="button"
                size="small"
                variant="ghost"
                data-testid="lasso-delete-selection"
                aria-label="Delete selected strokes"
                onClick={handleDeleteSelection}
                style={{ pointerEvents: 'auto' }}
              >
                Delete
              </Button>
            </Popover>
          )}
          {/* MiniMap 覆盖在画布右上角 */}
          {showMinimap && (
            <div
              data-testid="painting-board-minimap"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 10,
              }}
            >
              <Minimap
                strokes={strokes}
                viewport={currentViewport}
                onViewportChange={handleViewportChange}
                hostSize={hostSize}
              />
            </div>
          )}
        </div>
        {/* 底部工具栏：PaintingBoard 内部作为 PaintingController 的受控宿主。
            外部需要共享底部栏时传 toolbar={false} 并自行渲染 PaintingController。 */}
        {toolbarOptions && (
          <PaintingController
            data={controllerData}
            onDataChange={handleControllerDataChange}
            tools={tools}
            theme={toolbarOptions.theme}
            edge={toolbarOptions.edge}
            edgeOffset={toolbarOptions.edgeOffset}
            showLabels={toolbarOptions.showLabels}
          />
        )}
      </div>
    );
  }
);
