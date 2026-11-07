import { Icon, type IconName } from '@hamster-note/components';
import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LayeredEditorController, LayeredEditorTool } from '../core/layeredEditorController';
import type { PressureMode } from '../model/document';
import { useEditorSnapshot } from './useEditorSnapshot';
import { useInputInitialization } from './useInputInitialization';
import { isLayeredInputMode } from '../core/layeredInputMode';
import { writeInputModePreference } from './inputModePreference';
import { ToolbarPanel } from './ToolbarPanel';
import { toolbarStyles } from './toolbarStyles';
import { ToolbarNumberField } from './ToolbarNumberField';
import { ToolbarChoiceField, ToolbarHexColorField } from './ToolbarPickerFields';

const SHAPES: readonly [LayeredEditorTool, string, IconName][] = [
  ['line', '直线', 'line'],
  ['rect', '矩形', 'rectangle'],
  ['ellipse', '椭圆', 'ellipse'],
  ['polygon', '多边形', 'polygon'],
  ['bezier', '贝塞尔', 'curve'],
  ['image', '图片', 'image'],
];
const TOOLS: typeof SHAPES = [['freehand', '画笔', 'pen'], ...SHAPES, ['text', '文字', 'type']];
const COLORS = [
  ['黑', '#2D2D2D'],
  ['蓝', '#7FA3C3'],
  ['绿', '#8FBA8D'],
  ['黄', '#D5B984'],
  ['粉', '#CD9BAA'],
  ['紫', '#AB9CC2'],
] as const;
const editableStyle: CSSProperties = {
  userSelect: 'text',
  WebkitUserSelect: 'text',
  WebkitTouchCallout: 'default',
};
type Panel = 'tools' | 'settings' | 'zoom';
export type ToolbarProps = {
  controller: LayeredEditorController;
  /** floating is positioned within the nearest positioned parent (normally PaintingBoard). */
  placement?: 'inline' | 'floating';
  /** Use page controls instead of focus-triggered native select/color pickers. */
  inlinePickers?: boolean;
};

/** Low-frequency channels only; raw input never renders the toolbar. */
export function Toolbar({ controller, placement = 'inline', inlinePickers = false }: ToolbarProps) {
  const inputReady = useInputInitialization(controller);
  const input = useEditorSnapshot(controller, 'input');
  const { activeTool, settings } = useEditorSnapshot(controller, 'tools');
  const history = useEditorSnapshot(controller, 'history');
  const navigation = useEditorSnapshot(controller, 'navigation');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const [collapsed, setCollapsed] = useState(false);
  const document = useEditorSnapshot(controller, 'document');
  const [openPanel, setOpenPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const descriptionId = useId();
  const wasCollapsed = useRef(false);
  useLayoutEffect(() => {
    if (collapsed || wasCollapsed.current) collapseButton.current?.focus();
    wasCollapsed.current = collapsed;
  }, [collapsed]);
  const freehand = activeTool === 'freehand';
  const shape = ['line', 'rect', 'ellipse', 'polygon', 'bezier'].includes(activeTool);
  const style = freehand ? settings.freehand : settings.shape;
  const supportedColor = freehand || shape;
  const customColorActive =
    supportedColor &&
    !COLORS.some(([, color]) => color.toLowerCase() === style.color.toLowerCase());
  const currentTool = TOOLS.find(([tool]) => tool === activeTool);
  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpenPanel(null);
    if (restoreFocus) anchor.current?.focus();
  }, []);
  const togglePanel = (panel: Panel, trigger: HTMLButtonElement) => {
    anchor.current = trigger;
    setOpenPanel(openPanel === panel ? null : panel);
  };
  const zoomFocalPoint = () => {
    const element = root.current!;
    const view = element.ownerDocument.defaultView!;
    const container = element.closest('[data-painting-board]') ?? element.parentElement;
    const surface = container?.querySelector<HTMLElement>('[data-drawing-viewport]');
    const visual = view.visualViewport;
    const visible = {
      left: visual?.offsetLeft ?? 0,
      top: visual?.offsetTop ?? 0,
      width: visual?.width ?? view.innerWidth,
      height: visual?.height ?? view.innerHeight,
    };
    if (surface) {
      const rect = surface.getBoundingClientRect();
      const origin = { x: rect.left + surface.clientLeft, y: rect.top + surface.clientTop };
      const left = Math.max(origin.x, visible.left),
        top = Math.max(origin.y, visible.top);
      const right = Math.min(rect.right, visible.left + visible.width),
        bottom = Math.min(rect.bottom, visible.top + visible.height);
      if (right > left && bottom > top)
        return { x: (left + right) / 2 - origin.x, y: (top + bottom) / 2 - origin.y };
    }
    return { x: visible.width / 2, y: visible.height / 2 };
  };
  const updateStyle = (patch: { color?: string; opacity?: number; width?: number }) => {
    if (freehand) {
      controller.setFreehandSettings({
        ...settings.freehand,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
        ...(patch.width !== undefined ? { nominalSize: patch.width } : {}),
      });
    } else {
      controller.setShapeSettings({ ...settings.shape, ...patch });
    }
  };
  const menuButton = (panel: Panel, label: string) => (
    <button
      type="button"
      aria-label={label}
      className={panel === 'zoom' ? 'hn-painting-zoom' : undefined}
      title={label}
      aria-haspopup={panel === 'tools' ? 'menu' : 'dialog'}
      aria-expanded={openPanel === panel}
      aria-pressed={panel === 'tools' ? Boolean(currentTool) : undefined}
      aria-controls={openPanel === panel ? panelId : undefined}
      onClick={(event) => togglePanel(panel, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          anchor.current = event.currentTarget;
          setOpenPanel(panel);
        }
      }}
    >
      {panel === 'zoom' ? (
        `${Math.round(viewport.scale * 100)}%`
      ) : panel === 'tools' ? (
        <>
          <Icon name={currentTool?.[2] ?? 'pen'} />
          {currentTool?.[1] ?? '工具'}
          <Icon name="chevron-down" />
        </>
      ) : (
        <Icon name="settings" />
      )}
    </button>
  );
  if (!inputReady) return null;
  return (
    <div
      ref={root}
      className="hn-painting-toolbar-shell"
      data-toolbar-placement={placement}
      role="region"
      aria-label="绘图工具栏，可横向滚动"
      style={{
        ...(placement === 'floating'
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              zIndex: 20,
              pointerEvents: 'none',
            }
          : { position: 'relative', maxWidth: '100%' }),
        display: 'flex',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <style>{toolbarStyles}</style>
      <button
        ref={collapseButton}
        type="button"
        className="hn-painting-collapse"
        data-interactive="true"
        aria-label={collapsed ? '展开工具栏' : '收起工具栏'}
        aria-expanded={!collapsed}
        onClick={() => {
          closePanel(false);
          setCollapsed(!collapsed);
        }}
      >
        <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} />
      </button>
      {!collapsed ? (
        <div
          role="toolbar"
          aria-label="绘图工具"
          data-input-mode={input.mode}
          data-interactive="true"
          className="hn-painting-toolbar"
          onFocusCapture={(event) => {
            const target = event.target as HTMLElement;
            // Scroll only the capsule; scrollIntoView could move the host document.
            const strip = event.currentTarget;
            const rect = target.getBoundingClientRect();
            const bounds = strip.getBoundingClientRect();
            if (rect.left < bounds.left + 8) strip.scrollLeft -= bounds.left + 8 - rect.left;
            if (rect.right > bounds.right - 8) strip.scrollLeft += rect.right - bounds.right + 8;
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'nowrap',
            flex: '0 1 auto',
            minWidth: 0,
            width: 'max-content',
            maxWidth: 'calc(100% - 32px)',
            height: 60,
            padding: '7px 12px',
            boxSizing: 'border-box',
            borderRadius: 30,
            border: '1px solid #E2E5EA',
            background: '#F5F6F8',
            boxShadow: '0 6px 24px rgba(15,23,42,0.12)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            pointerEvents: 'auto',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          <div className="hn-painting-group">
            <button
              type="button"
              aria-label="撤销"
              title="撤销"
              disabled={!history.canUndo}
              onClick={() => controller.undo()}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              aria-label="重做"
              title="重做"
              disabled={!history.canRedo}
              onClick={() => controller.redo()}
            >
              <Icon name="redo" />
            </button>
          </div>
          <span className="hn-painting-divider" aria-hidden="true" />
          <div className="hn-painting-group">{menuButton('zoom', '缩放比例')}</div>
          <span className="hn-painting-divider" aria-hidden="true" />
          <div className="hn-painting-group">{menuButton('tools', '工具菜单')}</div>
          <span className="hn-painting-divider" aria-hidden="true" />
          <div className="hn-painting-group hn-painting-width" role="group" aria-label="笔触宽度">
            <label>
              笔宽
              {supportedColor ? (
                <ToolbarNumberField
                  key={freehand ? 'freehand' : 'shape'}
                  label="笔宽"
                  min={0.5}
                  max={200}
                  step={0.5}
                  style={editableStyle}
                  value={freehand ? settings.freehand.nominalSize : settings.shape.width}
                  apply={(width) => {
                    updateStyle({ width });
                    const current = controller.getSnapshot('tools').settings;
                    return freehand ? current.freehand.nominalSize : current.shape.width;
                  }}
                />
              ) : (
                <input aria-label="笔宽" type="number" disabled value="" placeholder="—" />
              )}
            </label>
          </div>
          <span className="hn-painting-divider" aria-hidden="true" />
          <div className="hn-painting-group" role="group" aria-label="画布操作">
            {menuButton('settings', '设置')}
            <button
              type="button"
              aria-label="选择"
              title="选择"
              aria-pressed={activeTool === 'selection'}
              onClick={() => controller.setTool('selection')}
            >
              <Icon name="mouse" />
            </button>
            <button
              type="button"
              aria-label="橡皮擦"
              title="橡皮擦"
              aria-pressed={activeTool === 'eraser'}
              onClick={() => controller.setTool('eraser')}
            >
              <Icon name="eraser" />
            </button>
            <button
              type="button"
              aria-label="套索"
              title="套索"
              aria-pressed={activeTool === 'lasso'}
              onClick={() => controller.setTool('lasso')}
            >
              <Icon name="lasso" />
            </button>
            <button
              type="button"
              aria-label="移动"
              title="移动"
              aria-pressed={activeTool === 'pan'}
              onClick={() => controller.setTool('pan')}
            >
              <Icon name="drag" />
            </button>
            <button
              type="button"
              aria-label="清空画布"
              title="清空画布（可撤销）"
              disabled={document.objects.length === 0}
              onClick={() => {
                const latest = controller.getSnapshot('document');
                if (!latest.objects.length) return;
                const result = controller.editObjects({
                  expectedDocumentRevision: latest.documentRevision,
                  removeIds: latest.objects.map((object) => object.objectId),
                });
                if (result.ok) controller.setPreview(null);
              }}
            >
              <Icon name="delete" />
            </button>
          </div>
          <span className="hn-painting-divider" aria-hidden="true" />
          <div
            className="hn-painting-group hn-painting-palette"
            role="group"
            aria-label="调色板，用于绘图或形状"
          >
            {COLORS.map(([name, color]) => {
              const selected =
                (freehand || shape) && style.color.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  style={{ '--swatch-color': color } as CSSProperties}
                  type="button"
                  aria-label={name}
                  title={`${name}，用于绘图或形状`}
                  className="hn-painting-color"
                  disabled={!freehand && !shape}
                  aria-pressed={selected}
                  aria-describedby={`${descriptionId}-palette`}
                  onClick={() => updateStyle({ color })}
                >
                  <span style={{ background: color }} aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                </button>
              );
            })}
            {inlinePickers ? (
              <button
                type="button"
                className="hn-painting-color hn-painting-custom-color"
                aria-label="自由取色"
                title="自由取色"
                aria-haspopup="dialog"
                aria-expanded={openPanel === 'settings'}
                aria-controls={openPanel === 'settings' ? panelId : undefined}
                aria-description={customColorActive ? '当前自定义颜色' : '选择自定义颜色'}
                aria-describedby={`${descriptionId}-palette`}
                data-active={customColorActive}
                disabled={!supportedColor}
                style={{ '--current-color': style.color } as CSSProperties}
                onClick={(event) => togglePanel('settings', event.currentTarget)}
              >
                <span aria-hidden="true" />
              </button>
            ) : (
              <label
                className="hn-painting-custom-color"
                data-active={customColorActive}
                title={customColorActive ? '自由取色，当前自定义颜色' : '自由取色'}
                style={{ '--current-color': style.color } as CSSProperties}
              >
                <span aria-hidden="true" />
                <input
                  type="color"
                  aria-label="自由取色"
                  aria-description={customColorActive ? '当前自定义颜色' : '选择自定义颜色'}
                  value={style.color}
                  disabled={!freehand && !shape}
                  aria-describedby={`${descriptionId}-palette`}
                  onChange={(event) => updateStyle({ color: event.target.value })}
                />
              </label>
            )}
          </div>
        </div>
      ) : null}
      <span id={`${descriptionId}-palette`} hidden>
        用于绘图或形状
      </span>
      {openPanel && !collapsed ? (
        <ToolbarPanel
          key={openPanel}
          id={panelId}
          label={{ tools: '工具', settings: '绘图设置', zoom: '缩放设置' }[openPanel]}
          menu={openPanel === 'tools'}
          anchor={anchor}
          boundary={root}
          onClose={closePanel}
        >
          {openPanel === 'tools' ? (
            <>
              {TOOLS.map(([tool, label, icon]) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeTool === tool}
                  key={tool}
                  onClick={() => {
                    controller.setTool(tool);
                    closePanel(true);
                  }}
                >
                  <Icon name={icon} />
                  {label}
                </button>
              ))}
            </>
          ) : null}
          {openPanel === 'zoom' ? (
            <label>
              缩放{' '}
              <input
                aria-label="缩放"
                type="range"
                min={25}
                max={800}
                step={25}
                value={Math.round(viewport.scale * 100)}
                aria-valuetext={`${Math.round(viewport.scale * 100)}%`}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (!Number.isFinite(value) || value < 25 || value > 800) return;
                  const latest = controller.getSnapshot('viewport');
                  const focal = zoomFocalPoint();
                  controller.updateViewport({
                    type: 'transform',
                    expectedRevision: latest.revision,
                    intent: {
                      startFocal: focal,
                      currentFocal: focal,
                      scaleRatio: value / (latest.viewport.scale * 100),
                    },
                  });
                }}
              />
              <output>{Math.round(viewport.scale * 100)}%</output>
            </label>
          ) : null}
          {openPanel === 'settings' ? (
            <>
              <ToolbarChoiceField
                inline={inlinePickers}
                label="输入模式"
                value={input.mode}
                options={[
                  ['auto', '自动'],
                  ['finger', '强制手指绘制'],
                  ['pen', '强制手写笔绘制'],
                ]}
                onChange={(mode) => {
                  if (isLayeredInputMode(mode) && controller.setInputMode(mode).ok)
                    writeInputModePreference(mode);
                }}
              />
              {freehand || shape ? (
                <>
                  {inlinePickers ? (
                    <ToolbarHexColorField
                      value={style.color}
                      onChange={(color) => updateStyle({ color })}
                    />
                  ) : (
                    <label>
                      自定义颜色
                      <input
                        type="color"
                        aria-label="颜色"
                        title="颜色"
                        value={style.color}
                        onChange={(event) => updateStyle({ color: event.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    不透明度{' '}
                    <input
                      aria-label="不透明度"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      style={{ width: 80 }}
                      value={style.opacity}
                      onChange={(event) => updateStyle({ opacity: event.target.valueAsNumber })}
                    />
                  </label>
                </>
              ) : null}
              {freehand ? (
                <ToolbarChoiceField
                  inline={inlinePickers}
                  label="压力"
                  ariaLabel="压力模式"
                  value={settings.freehand.pressureMode}
                  options={[
                    ['auto', '自动'],
                    ['real', '真实'],
                    ['simulated', '模拟'],
                    ['constant', '恒定'],
                  ]}
                  onChange={(pressureMode) =>
                    controller.setFreehandSettings({
                      ...settings.freehand,
                      pressureMode: pressureMode as PressureMode,
                    })
                  }
                />
              ) : null}
              {shape ? (
                <ToolbarChoiceField
                  inline={inlinePickers}
                  label="线型"
                  ariaLabel="形状线型"
                  value={settings.shape.dash?.length ? 'dash' : 'solid'}
                  options={[
                    ['solid', '实线'],
                    ['dash', '虚线'],
                  ]}
                  onChange={(dash) =>
                    controller.setShapeSettings({
                      ...settings.shape,
                      dash: dash === 'dash' ? [8, 5] : [],
                    })
                  }
                />
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={navigation.ruler.visible}
                  onChange={(event) =>
                    controller.setNavigation({
                      ruler: { ...navigation.ruler, visible: event.target.checked },
                    })
                  }
                />
                尺子
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={navigation.paper}
                  onChange={(event) => controller.setNavigation({ paper: event.target.checked })}
                />
                虚拟纸张
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={navigation.minimap}
                  onChange={(event) => controller.setNavigation({ minimap: event.target.checked })}
                />
                小地图
              </label>
            </>
          ) : null}
        </ToolbarPanel>
      ) : null}
    </div>
  );
}
