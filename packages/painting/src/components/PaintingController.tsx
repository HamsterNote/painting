import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  Button,
  Icon,
  Menu,
  MenuItem,
  Popover,
  type IconName,
  type PopoverEdge,
  type PopoverTheme,
} from '@hamster-note/components';
import type { DrawingTool } from './DrawingSurface';

/**
 * PaintingController — 从 PaintingBoard 抽离的底部工具栏
 * ───────────────────────────────────────────────────────────────────────────
 * 完全受控的 BottomBar：不持有任何业务状态，只通过 `data` / `onDataChange`
 * 与外界通信。典型用法是页面上嵌入多个 `PaintingBoard`（各自 `toolbar={false}`），
 * 共享同一个 PaintingController，把同一份 `data` 分发给所有画板，
 * 实现「一个底部栏控制所有 PaintingBoard」：
 *
 * ```tsx
 * const [data, setData] = useState<PaintingControllerData>({ tool: 'pen', minimap: false });
 *
 * <PaintingController data={data} onDataChange={setData} />
 * <PaintingBoard toolbar={false} tool={data.tool} minimap={data.minimap} />
 * <PaintingBoard toolbar={false} tool={data.tool} minimap={data.minimap} />
 * ```
 *
 * ⚠️ Web-only：Popover 依赖 react-dom（createPortal），不支持 react-native。
 * 工具栏默认 `edge="bottom"`，Popover 内部以 position: fixed 吸附视口底部，
 * 因此组件在 DOM 树中的位置不影响展示位置。
 */

/** 底部栏默认展示的全部工具（顺序即展示顺序） */
export const PAINTING_BOARD_DEFAULT_TOOLS: readonly DrawingTool[] = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'eraser',
  'lasso',
];

/**
 * 工具 → 图标映射。组件库第一期图标集（见 ICON_NAMES）没有 polygon / lasso
 * 专用图标，这两类工具回退为纯文字按钮；后续图标集补齐后在此处补充即可。
 */
const TOOL_ICON_MAP: Partial<Record<DrawingTool, IconName>> = {
  pen: 'pen',
  line: 'line',
  rect: 'rectangle',
  ellipse: 'ellipse',
  bezier: 'curve',
  eraser: 'eraser',
};

/** 工具默认文字标签（无图标工具的回退展示 + 图标按钮的 aria-label） */
const TOOL_LABEL_MAP: Record<DrawingTool, string> = {
  pen: 'Pen',
  line: 'Line',
  rect: 'Rect',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  bezier: 'Bezier',
  eraser: 'Eraser',
  lasso: 'Lasso',
};

/**
 * PaintingController 的受控数据。这份 data 同时也是分发给各个
 * PaintingBoard 的控制面：`tool` 决定画板当前工具，`minimap` 决定
 * 画板是否展示 Minimap。后续期次（颜色 / 线宽 / 撤销重做）在此扩展字段即可。
 */
export interface PaintingControllerData {
  /** 当前激活工具 */
  readonly tool: DrawingTool;
  /** 是否展示 Minimap */
  readonly minimap: boolean;
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
}: PaintingControllerProps) {
  const { tool: activeTool, minimap: showMinimap } = data;

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
      onDataChange({ ...data, tool: next });
    },
    [data, onDataChange]
  );

  const handleToggleMinimap = useCallback(() => {
    onDataChange({ ...data, minimap: !data.minimap });
  }, [data, onDataChange]);

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
        style={style}
      >
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
            {TOOL_ICON_MAP[activeTool] ? (
              <Icon name={TOOL_ICON_MAP[activeTool]!} style={{ width: 16, height: 16 }} />
            ) : null}
            {TOOL_LABEL_MAP[activeTool]}
          </Button>
        ) : (
          tools.map((tool) => (
            <ToolButton
              key={tool}
              tool={tool}
              active={tool === activeTool}
              showLabel={showLabels}
              onSelect={handleSelectTool}
            />
          ))
        )}
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
      </Popover>
      {compactMenuOpen && compactMenuAnchor && (
        <Popover
          anchor={compactMenuAnchor}
          placement="top-start"
          theme={theme}
          data-testid="painting-board-compact-menu"
        >
          <Menu>
            {tools.map((tool) => (
              <MenuItem
                key={tool}
                data-testid={`painting-board-compact-tool-${tool}`}
                onClick={() => {
                  handleSelectTool(tool);
                  setCompactMenuOpen(false);
                }}
              >
                {tool === activeTool ? '✓ ' : ''}{TOOL_LABEL_MAP[tool]}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {/* 更多菜单：通过 anchor 定位到 body 下，避免被 overflow 裁剪 */}
      {moreMenuOpen && moreMenuAnchor && (
        <Popover
          anchor={moreMenuAnchor}
          placement="top-end"
          theme={theme}
          data-testid="painting-board-more-menu"
        >
          <Menu>
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
              MiniMap
            </MenuItem>
          </Menu>
        </Popover>
      )}
    </>
  );
}
