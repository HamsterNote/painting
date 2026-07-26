import {
  Button,
  Icon,
  type IconName,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  type PopoverEdge,
  type PopoverTheme,
} from '@hamster-note/components';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import type { PaintingHistoryControls } from '../hooks/usePaintingHistory';
import { resolveTextFontSize } from '../model/text';
import type { DrawingTool } from './DrawingSurface';
import { PaintingFontSizeControl } from './PaintingFontSizeControl';
import { PaintingStrokeColorControl } from './PaintingStrokeColorControl';
import { PaintingStrokeWidthControl } from './PaintingStrokeWidthControl';

/**
 * PaintingController — 从 PaintingBoard 抽离的底部工具栏
 * ───────────────────────────────────────────────────────────────────────────
 * 完全受控的 BottomBar：不持有任何业务状态，只通过 `data` / `onDataChange`
 * 与外界通信。典型用法是页面上嵌入多个 `PaintingBoard`（各自 `toolbar={false}`），
 * 共享同一个 PaintingController，把同一份 `data` 分发给所有画板，
 * 实现「一个底部栏控制所有 PaintingBoard」：
 *
 * ```tsx
 * const [data, setData] = useState<PaintingControllerData>({
 *   tool: 'pen',
 *   minimap: false,
 *   selection: null,
 * });
 *
 * <PaintingController data={data} onDataChange={setData} />
 * <PaintingBoard
 *   toolbar={false}
 *   controller={{ boardId: 'board-a', data, onDataChange: setData }}
 * />
 * <PaintingBoard
 *   toolbar={false}
 *   controller={{ boardId: 'board-b', data, onDataChange: setData }}
 * />
 * ```
 *
 * ⚠️ Web-only：Popover 依赖 react-dom（createPortal），不支持 react-native。
 * 工具栏默认 `edge="bottom"`，Popover 内部以 position: fixed 吸附视口底部，
 * 因此组件在 DOM 树中的位置不影响展示位置。
 *
 * ### multiBoard 模式（一个底栏控制多个 PaintingBoard）
 *
 * 当 `multiBoard` 为 `true` 时，底栏会隐藏「重置视角」「清空画布」按钮以及
 * More 菜单里的 MiniMap 开关。原因：这三个入口在语义上都「作用于单个画板」--
 * 重置视角只能重置一块画板的视口、清空画布只能清空一块画板的内容、MiniMap 也
 * 只反映单块画板的缩略图。当共享底栏同时控制多块画板时，让这些入口出现会引发
 * 歧义（用户无法预期它到底作用于哪一块），因此在多画板共享场景下统一隐藏。
 * 单画板场景（包括 PaintingBoard 内部自渲染的 PaintingController）不传
 * `multiBoard`，走默认值 `false`，行为不变。
 *
 * ### compact 模式（屏幕宽度 < 768px）
 *
 * 屏幕宽度 < 768px 时工具栏进入 compact 模式：工具合并为单按钮下拉菜单，
 * 「压感」「手写笔」「清空画布」三个按钮从工具栏内联位置收纳进 More 菜单。
 * compact 模式下 More 按钮即使 multiBoard 也展示（用于承载收纳项），但
 * MiniMap 与「清空画布」在 multiBoard + compact 下仍隐藏（语义只作用于单画板），
 * 「压感」「手写笔」保留（它们是全局笔触设置，与具体画板无关）。
 */

/** 底部栏默认展示的全部工具（顺序即展示顺序） */
export const PAINTING_BOARD_DEFAULT_TOOLS: readonly DrawingTool[] = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'text',
  'eraser',
  'lasso',
];

const TOOL_ICON_MAP: Partial<Record<DrawingTool, IconName>> = {
  pen: 'pen',
  line: 'line',
  rect: 'rectangle',
  ellipse: 'ellipse',
  polygon: 'polygon',
  bezier: 'curve',
  text: 'type',
  eraser: 'eraser',
  lasso: 'lasso',
};

/** 工具默认文字标签（无图标工具的回退展示 + 图标按钮的 aria-label） */
const TOOL_LABEL_MAP: Record<DrawingTool, string> = {
  pen: 'Pen',
  line: 'Line',
  rect: 'Rect',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  bezier: 'Bezier',
  text: 'Text',
  eraser: 'Eraser',
  lasso: 'Lasso',
};

/**
 * PaintingController 的受控数据。这份 data 同时也是分发给各个
 * PaintingBoard 的控制面：`tool` 决定画板当前工具，`minimap` 决定
 * 画板是否展示 Minimap，`strokeWidth` / `strokeColor` 决定绘制笔触样式，`selection`
 * 保证多个受控画板之间的套索选区互斥，`stylusMode` 决定单指触摸的归属（绘图 or 平移画布）。
 * 后续期次（撤销重做）在此扩展字段即可。
 */
export interface PaintingControllerData {
  /** 当前激活工具 */
  readonly tool: DrawingTool;
  /** 是否展示 Minimap */
  readonly minimap: boolean;
  /** 当前笔触宽度；未传或无效时按 DrawingSurface 的默认值 2 展示 */
  readonly strokeWidth?: number;
  /** 当前笔触颜色；未传或为空时按 DrawingSurface 的默认黑色展示 */
  readonly strokeColor?: string;
  /** 当前文字字号；未传或无效时按 DrawingSurface 的默认值 24 展示 */
  readonly fontSize?: number;
  /** 当前由哪个画板持有套索选区；null 表示所有受控画板均未选中 */
  readonly selection?: PaintingControllerSelection | null;
  /** 手写笔模式：true=手写笔绘图+单指拖动画布（默认）；false=单指绘图+双指拖动画布 */
  readonly stylusMode?: boolean;
  /** 压感开关：true=pen 笔画宽度随手写笔压力变化；false/未传=均匀线宽（默认，与 DrawingSurface 安全默认对齐） */
  readonly pressure?: boolean;
}

/** 多画板共享套索选区，boardId 用于隔离不同画板中可能重复的 stroke id。 */
export interface PaintingControllerSelection {
  readonly boardId: string;
  readonly strokeIds: readonly string[];
}

export interface PaintingControllerProps {
  /** 受控数据（必填，组件本身不持有业务状态） */
  readonly data: PaintingControllerData;
  /** 用户通过底部栏修改数据时的回调，应回写完整 data */
  readonly onDataChange: (data: PaintingControllerData) => void;
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
  /** 透传给工具栏 Popover 的样式 */
  readonly style?: CSSProperties;
  /** 重置视角回调。传入后底栏展示「重置视角」按钮 */
  readonly onResetView?: () => void;
  /** 清空画布回调。传入后底栏展示「清空画布」按钮 */
  readonly onClearCanvas?: () => void;
  /** 导入图片回调。单画板工具栏传入后展示一次性的 Image 文件选择入口。 */
  readonly onInsertImage?: () => void;
  /** 撤销与恢复命令；传入后在底栏最左侧展示两个始终可发现的入口。 */
  readonly history?: PaintingHistoryControls;
  /**
   * 是否处于「一个底栏控制多个 PaintingBoard」的多画板共享模式，默认 false。
   * 为 true 时隐藏「重置视角」「清空画布」按钮及 More 菜单（含 MiniMap 开关），
   * 因为这三者在语义上只作用于单个画板，共享控制多画板时出现会引发歧义。
   * 详见组件顶部 doc comment 的 multiBoard 章节。
   */
  readonly multiBoard?: boolean;
  /**
   * 工具栏 Popover 是否以「相对定位模式」渲染，
   * 默认 false，保持原有 position: fixed 吸附视口底部行为不变。
   *
   * 传入 true 后贴边改用 position: absolute：工具栏脱离视口吸附，改为贴在
   * 「最近的定位祖先」对应边缘并跟随其滚动/裁切。适用于把工具栏嵌入到一个
   * 已有定位上下文（position: relative/absolute 等）的容器内的场景（例如
   * PaintingBoard 内部自渲染的底部栏：画板根 div 已是 position: relative，
   * 工具栏即可自然贴在画板底部，随画板容器走）。
   */
  readonly relative?: boolean;
}

/**
 * 单个工具按钮。图标按钮带 aria-label 保证可访问性；激活态用
 * variant="primary" 与未激活的 "ghost" 区分，并同步 aria-pressed。
 */
function ToolButton({
  tool,
  active,
  showLabel,
  onSelect,
}: {
  readonly tool: DrawingTool;
  readonly active: boolean;
  readonly showLabel: boolean;
  readonly onSelect: (tool: DrawingTool) => void;
}) {
  const iconName = TOOL_ICON_MAP[tool];
  const label = TOOL_LABEL_MAP[tool];
  const handleClick = useCallback(() => onSelect(tool), [onSelect, tool]);
  return (
    <Button
      type="button"
      size="small"
      variant={active ? 'primary' : 'ghost'}
      data-tool={tool}
      aria-pressed={active}
      aria-label={label}
      onClick={handleClick}
    >
      {iconName ? <Icon name={iconName} style={{ width: 16, height: 16 }} /> : null}
      {showLabel || !iconName ? label : null}
    </Button>
  );
}

export function PaintingController({
  data,
  onDataChange,
  tools = PAINTING_BOARD_DEFAULT_TOOLS,
  theme = 'dark',
  edge = 'bottom',
  edgeOffset = 16,
  showLabels = false,
  style,
  onResetView,
  onClearCanvas,
  onInsertImage,
  history,
  multiBoard = false,
  relative = false,
}: PaintingControllerProps) {
  const { tool: activeTool, minimap: showMinimap, stylusMode: stylusModeFromData } = data;
  // stylusMode 默认 true（手写笔模式），与 DrawingSurface 的安全默认对齐
  const stylusMode = stylusModeFromData ?? true;
  // pressure 默认 false（均匀线宽），与 DrawingSurface 的安全默认对齐
  const pressure = data.pressure ?? false;
  const strokeWidth =
    typeof data.strokeWidth === 'number' &&
    Number.isFinite(data.strokeWidth) &&
    data.strokeWidth >= 1
      ? data.strokeWidth
      : 2;
  const strokeColor = data.strokeColor?.trim() || '#000000';
  const fontSize = resolveTextFontSize(data.fontSize);
  const activeToolIcon = TOOL_ICON_MAP[activeTool];

  // ===== 纯 UI 状态（不进 data，与画板控制无关） =====
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<HTMLElement | null>(null);

  // 响应式：屏幕宽度 < 768px 时合并工具为单按钮下拉菜单
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  const [compactMenuOpen, setCompactMenuOpen] = useState(false);
  const [compactMenuAnchor, setCompactMenuAnchor] = useState<HTMLElement | null>(null);

  // ===== data 变更回调：基于现有 data 生成新 data，保持未修改字段不变 =====
  const handleSelectTool = useCallback(
    (next: DrawingTool) => {
      onDataChange({
        ...data,
        tool: next,
        selection:
          (next === 'lasso' || next === 'text') &&
          (data.tool === 'lasso' || data.tool === 'text')
            ? (data.selection ?? null)
            : null,
      });
    },
    [data, onDataChange]
  );

  const handleToggleMinimap = useCallback(() => {
    onDataChange({ ...data, minimap: !data.minimap });
  }, [data, onDataChange]);

  useEffect(() => {
    if (multiBoard && data.minimap) {
      onDataChange({ ...data, minimap: false });
    }
  }, [multiBoard, data.minimap, data, onDataChange]);

  const handleStrokeWidthChange = useCallback(
    (nextStrokeWidth: number) => {
      onDataChange({ ...data, strokeWidth: nextStrokeWidth });
    },
    [data, onDataChange]
  );

  const handleStrokeColorChange = useCallback(
    (nextStrokeColor: string) => {
      onDataChange({ ...data, strokeColor: nextStrokeColor });
    },
    [data, onDataChange]
  );

  const handleFontSizeChange = useCallback(
    (nextFontSize: number) => {
      onDataChange({ ...data, fontSize: nextFontSize });
    },
    [data, onDataChange]
  );

  // 切换手写笔模式：翻转 data.stylusMode，走与 tool/minimap 相同的 data 回写通道
  const handleToggleStylusMode = useCallback(() => {
    onDataChange({ ...data, stylusMode: !stylusMode });
  }, [data, onDataChange, stylusMode]);

  // 切换压感：翻转 data.pressure，走与 stylusMode 相同的 data 回写通道
  const handleTogglePressure = useCallback(() => {
    onDataChange({ ...data, pressure: !pressure });
  }, [data, onDataChange, pressure]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  // 外部点击关闭 compact 菜单
  useEffect(() => {
    if (!compactMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (compactMenuAnchor?.contains(target)) return;
      if (target.closest('[data-testid="painting-board-compact-menu"]')) return;
      setCompactMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [compactMenuOpen, compactMenuAnchor]);

  // 外部点击关闭更多菜单。
  // ⚠️ 菜单 Popover 经 Portal 渲染到 document.body 下，不在 anchor 按钮的
  // DOM 子树内，因此「点击菜单项」对 anchor 来说也是「外部点击」。如果只用
  // anchor.contains(target) 判断，mousedown（捕获阶段，先于 click）就会先
  // 把菜单卸载，导致 MenuItem 的 onClick 永远收不到 —— MiniMap 无法打开。
  // 所以这里必须额外豁免菜单浮层本身的点击。
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (moreMenuAnchor?.contains(target)) return;
      if (target.closest('[data-testid="painting-board-more-menu"]')) return;
      setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [moreMenuOpen, moreMenuAnchor]);

  return (
    <>
      <Popover
        data-testid="painting-board-toolbar"
        theme={theme}
        edge={edge}
        edgeOffset={edgeOffset}
        orientation="horizontal"
        style={
          relative
            ? { ...style, position: 'absolute' }
            : { zIndex: 1000, ...style }
        }
      >
        {history ? (
          <>
            <Button
              type="button"
              size="small"
              variant="ghost"
              data-testid="painting-board-undo"
              aria-label="Undo"
              disabled={!history.canUndo}
              onClick={history.undo}
            >
              <Icon name="undo" style={{ width: 16, height: 16 }} />
              {showLabels ? 'Undo' : null}
            </Button>
            <Button
              type="button"
              size="small"
              variant="ghost"
              data-testid="painting-board-redo"
              aria-label="Redo"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              <Icon name="redo" style={{ width: 16, height: 16 }} />
              {showLabels ? 'Redo' : null}
            </Button>
          </>
        ) : null}
        {isCompact ? (
          <Button
            type="button"
            size="small"
            variant="primary"
            data-testid="painting-board-compact-tool-btn"
            aria-haspopup="menu"
            aria-expanded={compactMenuOpen}
            aria-label={TOOL_LABEL_MAP[activeTool]}
            onClick={(event) => {
              setCompactMenuAnchor(event.currentTarget);
              setCompactMenuOpen((v) => !v);
            }}
          >
            {activeToolIcon ? (
              <Icon name={activeToolIcon} style={{ width: 16, height: 16 }} />
            ) : null}
            {TOOL_LABEL_MAP[activeTool]}
          </Button>
        ) : (
          <>
            {tools.map((tool) => (
              <ToolButton
                key={tool}
                tool={tool}
                active={tool === activeTool}
                showLabel={showLabels}
                onSelect={handleSelectTool}
              />
            ))}
            {onInsertImage && !multiBoard ? (
              <Button
                type="button"
                size="small"
                variant="ghost"
                data-testid="painting-board-image-tool"
                aria-label="Image"
                onClick={onInsertImage}
              >
                <Icon name="image" style={{ width: 16, height: 16 }} />
                {showLabels ? 'Image' : null}
              </Button>
            ) : null}
          </>
        )}
        {activeTool === 'text' ? (
          <>
            <PaintingStrokeColorControl
              strokeColor={strokeColor}
              theme={theme}
              onStrokeColorChange={handleStrokeColorChange}
            />
            <PaintingFontSizeControl
              fontSize={fontSize}
              theme={theme}
              onFontSizeChange={handleFontSizeChange}
            />
          </>
        ) : activeTool !== 'lasso' ? (
          <>
            <PaintingStrokeColorControl
              strokeColor={strokeColor}
              theme={theme}
              onStrokeColorChange={handleStrokeColorChange}
            />
            <PaintingStrokeWidthControl
              strokeWidth={strokeWidth}
              theme={theme}
              onStrokeWidthChange={handleStrokeWidthChange}
            />
            {/* 压感开关：仅影响 pen 笔画，与颜色/宽度同属笔触样式组。
                compact 模式下收纳进 More 菜单（见 painting-board-more-pressure）。 */}
            {!isCompact ? (
              <Button
                type="button"
                size="small"
                variant={pressure ? 'primary' : 'ghost'}
                data-testid="painting-board-pressure-toggle"
                aria-pressed={pressure}
                aria-label="Pressure sensitivity"
                onClick={handleTogglePressure}
              >
                <Icon name="edit" style={{ width: 16, height: 16 }} />
                {showLabels ? 'Pressure' : null}
              </Button>
            ) : null}
          </>
        ) : null}
        {/* 手写笔模式切换：属 data 契约。compact 模式下收纳进 More 菜单
            （见 painting-board-more-stylus），非 compact 时常驻工具栏。 */}
        {!isCompact ? (
          <Button
            type="button"
            size="small"
            variant={stylusMode ? 'primary' : 'ghost'}
            data-testid="painting-board-stylus-toggle"
            aria-pressed={stylusMode}
            aria-label="Stylus mode"
            onClick={handleToggleStylusMode}
          >
            <Icon name="touch" style={{ width: 16, height: 16 }} />
            {showLabels ? 'Stylus' : null}
          </Button>
        ) : null}
        {/* 重置视角：仅当传入 onResetView 且非多画板共享模式时渲染 */}
        {onResetView && !multiBoard ? (
          <Button
            type="button"
            size="small"
            variant="ghost"
            data-testid="painting-board-reset-view"
            aria-label="Reset view"
            onClick={onResetView}
          >
            <Icon name="locate" style={{ width: 16, height: 16 }} />
            {showLabels ? 'Reset' : null}
          </Button>
        ) : null}
        {/* 清空画布：仅当传入 onClearCanvas 且非多画板共享模式时渲染。
            compact 模式下收纳进 More 菜单（见 painting-board-more-clear-canvas）。 */}
        {onClearCanvas && !multiBoard && !isCompact ? (
          <Button
            type="button"
            size="small"
            variant="ghost"
            data-testid="painting-board-clear-canvas"
            aria-label="Clear canvas"
            onClick={onClearCanvas}
          >
            <Icon name="delete" style={{ width: 16, height: 16 }} />
            {showLabels ? 'Clear' : null}
          </Button>
        ) : null}
        {/* More 菜单按钮：单画板模式始终展示；compact 模式下即使 multiBoard
            也展示（用于收纳压感/手写笔等按钮）。multiBoard + 非 compact 时不渲染。 */}
        {!multiBoard || isCompact ? (
          <Button
            type="button"
            size="small"
            variant="ghost"
            data-testid="painting-board-more-btn"
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            aria-label="More"
            onClick={(event) => {
              setMoreMenuAnchor(event.currentTarget);
              setMoreMenuOpen((v) => !v);
            }}
          >
            <Icon name="more" style={{ width: 16, height: 16 }} />
          </Button>
        ) : null}
      </Popover>
      {compactMenuOpen && compactMenuAnchor && (
        <Popover
          anchor={compactMenuAnchor}
          placement="top-start"
          theme={theme}
          data-testid="painting-board-compact-menu"
        >
          <Menu>
            {tools.map((tool) => {
              const iconName = TOOL_ICON_MAP[tool];
              const isActive = tool === activeTool;
              return (
                <MenuItem
                  key={tool}
                  data-testid={`painting-board-compact-tool-${tool}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    ...(isActive
                      ? { background: 'var(--hn-color-accent)', color: '#09090b' }
                      : {}),
                  }}
                  onClick={() => {
                    handleSelectTool(tool);
                    setCompactMenuOpen(false);
                  }}
                >
                  {iconName ? (
                    <Icon name={iconName} style={{ width: 14, height: 14 }} />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{ display: 'inline-block', width: 14, height: 14 }}
                    />
                  )}
                  {TOOL_LABEL_MAP[tool]}
                </MenuItem>
              );
            })}
            {onInsertImage && !multiBoard ? (
              <MenuItem
                data-testid="painting-board-compact-tool-image"
                onClick={() => {
                  onInsertImage();
                  setCompactMenuOpen(false);
                }}
              >
                <Icon name="image" style={{ width: 14, height: 14 }} />
                Image
              </MenuItem>
            ) : null}
          </Menu>
        </Popover>
      )}
      {/* 更多菜单：通过 anchor 定位到 body 下，避免被 overflow 裁剪。
          单画板模式或 compact 模式下渲染；multiBoard + 非 compact 时不渲染。 */}
      {(!multiBoard || isCompact) && moreMenuOpen && moreMenuAnchor && (
        <Popover
          anchor={moreMenuAnchor}
          placement="top-end"
          theme={theme}
          data-testid="painting-board-more-menu"
        >
          <Menu>
            {/* MiniMap 开关：仅单画板模式展示 */}
            {!multiBoard ? (
              <MenuItem
                data-testid="painting-board-minimap-toggle"
                style={
                  showMinimap
                    ? { background: 'var(--hn-color-accent)', color: '#09090b' }
                    : undefined
                }
                onClick={() => {
                  handleToggleMinimap();
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="minimap" style={{ width: 14, height: 14 }} />
                MiniMap
              </MenuItem>
            ) : null}
            {/* compact 模式下把压感/手写笔/清空收纳进 More 菜单 */}
            {!multiBoard && isCompact ? <MenuSeparator /> : null}
            {isCompact && activeTool !== 'lasso' && activeTool !== 'text' ? (
              <MenuItem
                data-testid="painting-board-more-pressure"
                aria-pressed={pressure}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  ...(pressure ? { background: 'var(--hn-color-accent)', color: '#09090b' } : {}),
                }}
                onClick={() => {
                  handleTogglePressure();
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="edit" style={{ width: 14, height: 14 }} />
                Pressure
              </MenuItem>
            ) : null}
            {isCompact ? (
              <MenuItem
                data-testid="painting-board-more-stylus"
                aria-pressed={stylusMode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  ...(stylusMode ? { background: 'var(--hn-color-accent)', color: '#09090b' } : {}),
                }}
                onClick={() => {
                  handleToggleStylusMode();
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="touch" style={{ width: 14, height: 14 }} />
                Stylus
              </MenuItem>
            ) : null}
            {isCompact && onClearCanvas && !multiBoard ? (
              <MenuItem
                data-testid="painting-board-more-clear-canvas"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={() => {
                  onClearCanvas?.();
                  setMoreMenuOpen(false);
                }}
              >
                <Icon name="delete" style={{ width: 14, height: 14 }} />
                Clear
              </MenuItem>
            ) : null}
          </Menu>
        </Popover>
      )}
    </>
  );
}
