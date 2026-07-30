import { Button, Popover, type PopoverTheme } from '@hamster-note/components';
import {
  type ChangeEvent,
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type PaintingHistory,
  type PaintingHistoryControls,
  usePaintingHistory,
} from '../hooks/usePaintingHistory';
import { fitImageIntoViewport } from '../model/image';
import { generateStrokeId } from '../stroke-helpers';
import { DEFAULT_DRAWING_VIEWPORT, type DrawingViewport, normalizeViewport } from '../viewport';
import type { DrawingSurfaceVirtualPaperInteraction } from '../virtualPaperOptions';
import {
  type DrawingSelectionOverlay,
  DrawingSurface,
  type DrawingSurfaceHandle,
  type DrawingSurfaceProps,
  type DrawingTool,
  type DrawingValue,
} from './DrawingSurface';
import {
  PAINTING_BOARD_DEFAULT_TOOLS,
  PaintingController,
  type PaintingControllerData,
} from './PaintingController';

/**
 * PaintingBoard — DrawingSurface 的产品化封装
 * ───────────────────────────────────────────────────────────────────────────
 * 在 DrawingSurface 之上叠加工具栏。工具栏 UI 已抽离为独立的
 * `PaintingController`（完全受控，通过 `data` / `onDataChange` 通信）：
 * PaintingBoard 默认在内部渲染一个 PaintingController 并自行托管 data；
 * 需要「一个底部栏控制多个画板」时，给每个 PaintingBoard 传 `toolbar={false}`，
 * 并通过 `controller` 绑定同一份 data。工具、Minimap、尺子和互斥套索选区均由该 data 管理。
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

/** 选区 Popover 置于选区上方时的间距（px）。
 *  需避开选框顶边中心上方的旋转手柄：手柄中心距顶边 24px、hit 半径 12px，
 *  即 hit 区域覆盖顶边上方 12~36px（见 DrawingSurface 的
 *  LASSO_ROTATE_HANDLE_OFFSET_PX / LASSO_ROTATE_HANDLE_HIT_SIZE_PX）。
 *  取 48px 让 Delete 按钮整体落在旋转手柄 hit 区之上，选区较窄时也不重叠。 */
const POPOVER_PLACEMENT_GAP_TOP = 48;
/** 选区 Popover 翻转到选区下方时的间距（px）；下方无旋转手柄，保持小间距 */
const POPOVER_PLACEMENT_GAP_BOTTOM = 8;
/** 选区顶部距宿主顶边小于该值时，Popover 翻转到选区下方展示 */
const POPOVER_PLACEMENT_MIN_TOP = 56;

/**
 * 手指绘图模式（stylusMode=false）下的虚拟纸交互集：
 * 移除单指平移（touchSingleFingerPan），让单指触摸回落到绘图；
 * 保留双指平移 + 双指缩放供手势操作画布。
 */
const FINGER_DRAWING_INTERACTIONS: readonly DrawingSurfaceVirtualPaperInteraction[] = [
  'trackpadScrollPan',
  'mouseWheelCtrlZoom',
  'touchTwoFingerPan',
  'touchTwoFingerZoom',
];

const EMPTY_DRAWING_VALUE: DrawingValue = { strokes: [] };

/** 套索选区 Popover 配置；传 `false` 可整体隐藏 */
export interface PaintingBoardSelectionPopoverOptions {
  /** Popover 主题，默认 'dark' */
  readonly theme?: PopoverTheme;
}

/** 将画板接入共享 PaintingControllerData 的受控绑定。 */
export interface PaintingBoardControllerBinding {
  /** 画板稳定且唯一的标识，用于区分不同画板中的同名 stroke。 */
  readonly boardId: string;
  /** 与外部 PaintingController 共享的受控数据。 */
  readonly data: PaintingControllerData;
  /** 共享数据更新回调。 */
  readonly onDataChange: (data: PaintingControllerData) => void;
  /** 与共享底栏及其他画板共用的绘制历史。 */
  readonly history?: PaintingHistory;
}

export interface PaintingBoardProps extends Omit<DrawingSurfaceProps, 'tool'> {
  /** 受控工具。传入后内部状态失效，切换仅通过 onToolChange 通知 */
  readonly tool?: DrawingTool;
  /** 非受控初始工具，默认 'pen' */
  readonly defaultTool?: DrawingTool;
  /** 工具切换回调（受控/非受控均触发） */
  readonly onToolChange?: (tool: DrawingTool) => void;
  /** 笔触宽度切换回调；传入 strokeWidth 时可用于受控回写 */
  readonly onStrokeWidthChange?: (strokeWidth: number) => void;
  /** 笔触颜色切换回调；传入 strokeColor 时可用于受控回写 */
  readonly onStrokeColorChange?: (strokeColor: string) => void;
  /** 文字字号切换回调；传入 fontSize 时可用于受控回写 */
  readonly onFontSizeChange?: (fontSize: number) => void;
  /** 受控 Minimap 可见性。传入后内部状态失效，切换仅通过 onMinimapVisibleChange 通知。
      命名为 minimapVisible 以区分 DrawingSurfaceProps 自带的 `minimap`（surface 内置小地图配置） */
  readonly minimapVisible?: boolean;
  /** Minimap 可见性切换回调（受控/非受控均触发） */
  readonly onMinimapVisibleChange?: (visible: boolean) => void;
  /** 受控尺子可见性。传入后内部状态失效，尺子配置仍沿用 `ruler`。 */
  readonly rulerVisible?: boolean;
  /** 尺子可见性切换回调（受控/非受控均触发） */
  readonly onRulerVisibleChange?: (visible: boolean) => void;
  /** 受控手写笔模式。true=手写笔绘图+单指拖动画布（默认）；false=单指绘图+双指拖动画布 */
  readonly stylusMode?: boolean;
  /** 手写笔模式切换回调（受控/非受控均触发） */
  readonly onStylusModeChange?: (stylusMode: boolean) => void;
  /** 压感切换回调（受控/非受控均触发）；压感本身的受控 prop 沿用 DrawingSurfaceProps 的 `pressure` */
  readonly onPressureChange?: (pressure: boolean) => void;
  /** 底部工具栏配置；`false` 隐藏。默认展示全部工具的深色底部栏 */
  readonly toolbar?: false | PaintingBoardToolbarOptions;
  /** 套索选区 Popover 配置；`false` 隐藏。默认展示含删除按钮的深色浮层 */
  readonly selectionPopover?: false | PaintingBoardSelectionPopoverOptions;
  /** 多画板共享工具、Minimap 与互斥套索选区的受控绑定。 */
  readonly controller?: PaintingBoardControllerBinding;
  /** 外层容器样式（DrawingSurface 自身不接收 style，作用于 PaintingBoard 容器） */
  readonly style?: CSSProperties;
}

export const PaintingBoard = forwardRef<DrawingSurfaceHandle, PaintingBoardProps>(
  function PaintingBoard(
    {
      tool: toolProp,
      defaultTool = 'pen',
      onToolChange,
      strokeWidth: strokeWidthProp,
      onStrokeWidthChange,
      strokeColor: strokeColorProp,
      onStrokeColorChange,
      fontSize: fontSizeProp,
      onFontSizeChange,
      minimapVisible: minimapVisibleProp,
      onMinimapVisibleChange,
      minimap: minimapProp,
      ruler: rulerProp,
      rulerVisible: rulerVisibleProp,
      onRulerVisibleChange,
      stylusMode: stylusModeProp,
      onStylusModeChange,
      pressure: pressureProp,
      onPressureChange,
      toolbar,
      selectionPopover,
      controller,
      onSelectionOverlayChange,
      onSelectionTransformStart: onSelectionTransformStartProp,
      onSelectionTransformEnd: onSelectionTransformEndProp,
      selectedStrokeIds: selectedStrokeIdsProp,
      onSelectionChange: onSelectionChangeProp,
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
    const localHistory = usePaintingHistory({
      __painting_board__: valueProp ?? surfaceProps.defaultValue ?? EMPTY_DRAWING_VALUE,
    });
    const history = controller?.history ?? localHistory;
    const historyBoardId = controller?.boardId ?? '__painting_board__';
    const historyValue = history.values[historyBoardId] ?? valueProp ?? EMPTY_DRAWING_VALUE;
    const isValueControlled = valueProp !== undefined && controller?.history === undefined;
    const renderedValue = isValueControlled ? (valueProp ?? historyValue) : historyValue;
    const historyValueRef = useRef(renderedValue);
    historyValueRef.current = renderedValue;

    // ===== 受控 / 非受控 tool 状态 =====
    const [innerTool, setInnerTool] = useState<DrawingTool>(defaultTool);
    const activeTool = controller?.data.tool ?? toolProp ?? innerTool;

    const [innerStrokeWidth, setInnerStrokeWidth] = useState(2);
    const activeStrokeWidth = controller?.data.strokeWidth ?? strokeWidthProp ?? innerStrokeWidth;

    const [innerStrokeColor, setInnerStrokeColor] = useState('#000000');
    const activeStrokeColor =
      controller?.data.strokeColor !== undefined
        ? controller.data.strokeColor.trim() || '#000000'
        : strokeColorProp !== undefined
          ? strokeColorProp.trim() || '#000000'
          : innerStrokeColor;

    const [innerFontSize, setInnerFontSize] = useState(24);
    const activeFontSize = controller?.data.fontSize ?? fontSizeProp ?? innerFontSize;

    // ===== 受控 / 非受控 Minimap 可见性状态 =====
    const minimapPropEnabled =
      minimapProp !== false && minimapProp !== undefined && (minimapProp.enabled ?? true);
    const [innerMinimapVisible, setInnerMinimapVisible] = useState(minimapPropEnabled);
    const showMinimap = controller
      ? controller.data.minimap
      : (minimapVisibleProp ?? innerMinimapVisible);
    const effectiveMinimap = useMemo(
      () => ({
        ...(minimapProp === false || minimapProp === undefined ? {} : minimapProp),
        enabled: showMinimap,
      }),
      [minimapProp, showMinimap]
    );

    const rulerPropEnabled =
      rulerProp !== false && rulerProp !== undefined && (rulerProp.enabled ?? true);
    const [innerRulerVisible, setInnerRulerVisible] = useState(rulerPropEnabled);
    const showRuler = controller
      ? (controller.data.ruler ?? false)
      : (rulerVisibleProp ?? innerRulerVisible);
    const effectiveRuler = useMemo(
      () => ({
        ...(rulerProp === false || rulerProp === undefined ? {} : rulerProp),
        enabled: showRuler,
      }),
      [rulerProp, showRuler]
    );

    useEffect(() => {
      if (!controller && minimapVisibleProp === undefined) {
        setInnerMinimapVisible(minimapPropEnabled);
      }
    }, [controller, minimapPropEnabled, minimapVisibleProp]);

    useEffect(() => {
      if (!controller && rulerVisibleProp === undefined) {
        setInnerRulerVisible(rulerPropEnabled);
      }
    }, [controller, rulerPropEnabled, rulerVisibleProp]);

    // ===== 受控 / 非受控手写笔模式状态 =====
    // 默认 true（手写笔模式），与 DrawingSurface 的安全默认对齐
    const [innerStylusMode, setInnerStylusMode] = useState(true);
    const stylusMode = controller?.data.stylusMode ?? stylusModeProp ?? innerStylusMode;

    // ===== 受控 / 非受控压感开关状态 =====
    // 默认 false（均匀线宽），与 DrawingSurface 的安全默认对齐
    const [innerPressure, setInnerPressure] = useState(false);
    const activePressure = controller?.data.pressure ?? pressureProp ?? innerPressure;

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
    // 把 tool / minimap / strokeWidth / strokeColor / stylusMode 聚合成 PaintingController 需要的 data；
    // PaintingBoard 内部渲染工具栏时即为「受控消费方」。
    const controllerData = useMemo<PaintingControllerData>(() => {
      return controller?.data
        ? { ...controller.data, ruler: showRuler }
        : {
            tool: activeTool,
            minimap: showMinimap,
            ruler: showRuler,
            strokeWidth: activeStrokeWidth,
            strokeColor: activeStrokeColor,
            fontSize: activeFontSize,
            stylusMode,
            pressure: activePressure,
          };
    }, [
      activePressure,
      activeStrokeColor,
      activeStrokeWidth,
      activeFontSize,
      activeTool,
      controller?.data,
      showMinimap,
      showRuler,
      stylusMode,
    ]);

    // PaintingController 回写 data：拆解字段，分别走 tool / minimap / stylusMode 的
    // 受控 / 非受控同步逻辑，与直接操作按钮时的行为完全一致。
    const handleControllerDataChange = useCallback(
      (next: PaintingControllerData) => {
        if (controller) {
          controller.onDataChange(next);
          if (next.tool !== activeTool) {
            onToolChange?.(next.tool);
          }
          if (next.minimap !== showMinimap) {
            onMinimapVisibleChange?.(next.minimap);
          }
          if (next.ruler !== undefined && next.ruler !== showRuler) {
            onRulerVisibleChange?.(next.ruler);
          }
          if (next.strokeWidth !== undefined && next.strokeWidth !== activeStrokeWidth) {
            onStrokeWidthChange?.(next.strokeWidth);
          }
          if (next.strokeColor !== undefined && next.strokeColor !== activeStrokeColor) {
            onStrokeColorChange?.(next.strokeColor);
          }
          if (next.fontSize !== undefined && next.fontSize !== activeFontSize) {
            onFontSizeChange?.(next.fontSize);
          }
          if (next.stylusMode !== undefined && next.stylusMode !== stylusMode) {
            onStylusModeChange?.(next.stylusMode);
          }
          if (next.pressure !== undefined && next.pressure !== activePressure) {
            onPressureChange?.(next.pressure);
          }
          return;
        }
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
        if (next.ruler !== undefined && next.ruler !== showRuler) {
          if (rulerVisibleProp === undefined) {
            setInnerRulerVisible(next.ruler);
          }
          onRulerVisibleChange?.(next.ruler);
        }
        if (next.strokeWidth !== undefined && next.strokeWidth !== activeStrokeWidth) {
          if (strokeWidthProp === undefined) {
            setInnerStrokeWidth(next.strokeWidth);
          }
          onStrokeWidthChange?.(next.strokeWidth);
        }
        if (next.strokeColor !== undefined && next.strokeColor !== activeStrokeColor) {
          if (strokeColorProp === undefined) {
            setInnerStrokeColor(next.strokeColor);
          }
          onStrokeColorChange?.(next.strokeColor);
        }
        if (next.fontSize !== undefined && next.fontSize !== activeFontSize) {
          if (fontSizeProp === undefined) {
            setInnerFontSize(next.fontSize);
          }
          onFontSizeChange?.(next.fontSize);
        }
        if (next.stylusMode !== undefined && next.stylusMode !== stylusMode) {
          if (stylusModeProp === undefined) {
            setInnerStylusMode(next.stylusMode);
          }
          onStylusModeChange?.(next.stylusMode);
        }
        if (next.pressure !== undefined && next.pressure !== activePressure) {
          if (pressureProp === undefined) {
            setInnerPressure(next.pressure);
          }
          onPressureChange?.(next.pressure);
        }
      },
      [
        activePressure,
        activeTool,
        activeStrokeColor,
        activeStrokeWidth,
        activeFontSize,
        controller,
        minimapVisibleProp,
        onMinimapVisibleChange,
        onPressureChange,
        onRulerVisibleChange,
        onStrokeWidthChange,
        onStrokeColorChange,
        onFontSizeChange,
        onStylusModeChange,
        onToolChange,
        pressureProp,
        rulerVisibleProp,
        showMinimap,
        showRuler,
        stylusMode,
        stylusModeProp,
        strokeColorProp,
        fontSizeProp,
        strokeWidthProp,
        toolProp,
      ]
    );

    const sharedSelection = controller?.data.selection;
    const controlledSelectedStrokeIds =
      controller && sharedSelection?.boardId === controller.boardId
        ? sharedSelection.strokeIds
        : [];
    const handleSelectionChange = useCallback(
      (nextStrokeIds: string[]) => {
        if (controller) {
          if (nextStrokeIds.length > 0) {
            controller.onDataChange({
              ...controller.data,
              selection: {
                boardId: controller.boardId,
                strokeIds: nextStrokeIds,
              },
            });
          } else if (controller.data.selection?.boardId === controller.boardId) {
            controller.onDataChange({ ...controller.data, selection: null });
          }
        }
        onSelectionChangeProp?.(nextStrokeIds);
      },
      [controller, onSelectionChangeProp]
    );

    const handleCanvasPointerDownCapture = useCallback(() => {
      if (
        controller &&
        (activeTool === 'lasso' || activeTool === 'text') &&
        controller.data.selection !== null &&
        controller.data.selection !== undefined &&
        controller.data.selection.boardId !== controller.boardId
      ) {
        controller.onDataChange({ ...controller.data, selection: null });
      }
    }, [activeTool, controller]);

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

    // 追踪 viewport：受控时使用 viewportProp，非受控时通过 onViewportChange 同步。
    // 初始值同样尊重 defaultViewport，保证与 DrawingSurface 的非受控初始值一致。
    const [internalViewport, setInternalViewport] = useState<DrawingViewport>(
      viewportProp ?? defaultViewport ?? DEFAULT_DRAWING_VIEWPORT
    );
    const currentViewport = useMemo(
      () => viewportProp ?? internalViewport,
      [viewportProp, internalViewport]
    );

    const previousValuePropRef = useRef(valueProp);
    const lastNotifiedValueRef = useRef(historyValue);
    useEffect(() => {
      if (
        controller?.history ||
        valueProp === previousValuePropRef.current ||
        valueProp === undefined
      ) {
        return;
      }
      previousValuePropRef.current = valueProp;
      if (valueProp !== historyValue) {
        lastNotifiedValueRef.current = valueProp;
        localHistory.reset({ __painting_board__: valueProp });
      }
    }, [controller?.history, historyValue, localHistory, valueProp]);

    useEffect(() => {
      if (isValueControlled) return;
      if (historyValue === lastNotifiedValueRef.current) return;
      lastNotifiedValueRef.current = historyValue;
      onChangeProp?.(historyValue);
    }, [historyValue, isValueControlled, onChangeProp]);

    const handleChange = useCallback(
      (nextValue: DrawingValue) => {
        if (isValueControlled) {
          onChangeProp?.(nextValue);
          return;
        }
        history.setValue(historyBoardId, nextValue);
      },
      [history, historyBoardId, isValueControlled, onChangeProp]
    );
    const selectionTransactionOwnersRef = useRef<Array<(() => void) | null>>([]);
    const handleSelectionTransformStart = useCallback(() => {
      if (!isValueControlled) {
        history.beginTransaction();
        selectionTransactionOwnersRef.current.push(history.endTransaction);
      } else {
        selectionTransactionOwnersRef.current.push(null);
      }
      onSelectionTransformStartProp?.();
    }, [history, isValueControlled, onSelectionTransformStartProp]);
    const handleSelectionTransformEnd = useCallback(() => {
      selectionTransactionOwnersRef.current.pop()?.();
      onSelectionTransformEndProp?.();
    }, [onSelectionTransformEndProp]);

    useEffect(
      () => () => {
        for (const endTransaction of selectionTransactionOwnersRef.current.splice(0)) {
          endTransaction?.();
        }
      },
      []
    );

    // 拦截 onViewportChange，同步内部 viewport 状态
    const handleViewportChange = useCallback(
      (nextViewport: DrawingViewport) => {
        setInternalViewport(nextViewport);
        onViewportChangeProp?.(nextViewport);
      },
      [onViewportChangeProp]
    );

    // 根据 stylusMode 解析最终传给 DrawingSurface 的 virtualPaper 配置：
    // - stylusMode=true（默认）：沿用原有 virtualPaper，DrawingSurface 自行应用安全默认交互集
    // - stylusMode=false：注入 FINGER_DRAWING_INTERACTIONS，单指触摸回落到绘图、双指负责画布手势
    const resolvedVirtualPaper = useMemo(() => {
      if (stylusMode) return virtualPaper;
      if (virtualPaper === true) {
        return { enabledInteractions: FINGER_DRAWING_INTERACTIONS };
      }
      if (virtualPaper && typeof virtualPaper === 'object') {
        // 消费方显式配置 enabledInteractions 时优先尊重（高级用法，自行控制触摸归属）
        if (virtualPaper.enabledInteractions) return virtualPaper;
        return {
          ...virtualPaper,
          enabledInteractions: FINGER_DRAWING_INTERACTIONS,
        };
      }
      return virtualPaper;
    }, [stylusMode, virtualPaper]);

    // 重置视角：回到初始视口（defaultViewport，未传则为 DEFAULT_DRAWING_VIEWPORT）。
    // 受控模式下由父组件响应 onViewportChange 回传新 viewport。
    const handleResetView = useCallback(() => {
      const next = defaultViewport
        ? normalizeViewport(defaultViewport)
        : { ...DEFAULT_DRAWING_VIEWPORT };
      setInternalViewport(next);
      onViewportChangeProp?.(next);
    }, [defaultViewport, onViewportChangeProp]);

    const clearSelection = useCallback(() => {
      surfaceRef.current?.clearSelection();
      if (controller && controller.data.selection?.boardId === controller.boardId) {
        controller.onDataChange({ ...controller.data, selection: null });
      }
    }, [controller]);

    // 清空画布：删除全部 strokes 并清除选区。
    const handleClearCanvas = useCallback(() => {
      clearSelection();
      handleChange({ strokes: [] });
    }, [clearSelection, handleChange]);

    const handleUndo = useCallback(() => {
      surfaceRef.current?.clearSelection();
      history.undo();
    }, [history]);
    const handleRedo = useCallback(() => {
      surfaceRef.current?.clearSelection();
      history.redo();
    }, [history]);
    const toolbarHistory = useMemo<PaintingHistoryControls>(
      () => ({
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undo: handleUndo,
        redo: handleRedo,
      }),
      [handleRedo, handleUndo, history.canRedo, history.canUndo]
    );

    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const handleInsertImage = useCallback(() => {
      imageInputRef.current?.click();
    }, []);

    const handleImageFileChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = '';
        if (!file?.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result;
          if (typeof src !== 'string') return;

          const image = new Image();
          image.onload = () => {
            const wrapper = canvasWrapperRef.current;
            if (!wrapper || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
            const rect = wrapper.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const points = fitImageIntoViewport({
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              containerWidth: rect.width,
              containerHeight: rect.height,
              viewport: currentViewport,
            });
            const currentValue = historyValueRef.current;
            handleChange({
              strokes: [
                ...currentValue.strokes,
                {
                  id: generateStrokeId(),
                  tool: 'image',
                  points,
                  src,
                },
              ],
            });
          };
          image.src = src;
        };
        reader.readAsDataURL(file);
      },
      [currentViewport, handleChange]
    );

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
        <div
          ref={canvasWrapperRef}
          onPointerDownCapture={handleCanvasPointerDownCapture}
          style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            aria-label="Choose image file"
            onChange={handleImageFileChange}
            style={{ display: 'none' }}
          />
          <DrawingSurface
            ref={setSurfaceRef}
            tool={activeTool}
            strokeWidth={activeStrokeWidth}
            strokeColor={activeStrokeColor}
            fontSize={activeFontSize}
            pressure={activePressure}
            virtualPaper={resolvedVirtualPaper}
            value={renderedValue}
            onChange={handleChange}
            // 始终回传解析后的 viewport（而非仅受控时的 viewportProp），
            // 形成闭环：Minimap 拖拽 → handleViewportChange → setInternalViewport → 此处回传，
            // 让 DrawingSurface 真正把 Minimap 的变更应用到画板上。
            viewport={currentViewport}
            defaultViewport={defaultViewport}
            onViewportChange={handleViewportChange}
            onSelectionOverlayChange={handleSelectionOverlayChange}
            onSelectionTransformStart={handleSelectionTransformStart}
            onSelectionTransformEnd={handleSelectionTransformEnd}
            selectedStrokeIds={controller ? controlledSelectedStrokeIds : selectedStrokeIdsProp}
            onSelectionChange={handleSelectionChange}
            {...surfaceProps}
            minimap={effectiveMinimap}
            ruler={effectiveRuler}
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
                    ? selectionOverlay.y - POPOVER_PLACEMENT_GAP_TOP
                    : selectionOverlay.y + selectionOverlay.height + POPOVER_PLACEMENT_GAP_BOTTOM,
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
            onResetView={handleResetView}
            onClearCanvas={handleClearCanvas}
            onInsertImage={handleInsertImage}
            history={toolbarHistory}
            relative
          />
        )}
      </div>
    );
  }
);
