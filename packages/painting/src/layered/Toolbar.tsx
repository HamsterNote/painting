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

const SHAPES: readonly [LayeredEditorTool, string, IconName][] = [
  ['line', '直线', 'line'],
  ['rect', '矩形', 'rectangle'],
  ['ellipse', '椭圆', 'ellipse'],
  ['polygon', '多边形', 'polygon'],
  ['bezier', '贝塞尔', 'curve'],
  ['image', '图片', 'image'],
];
const DRAWING: typeof SHAPES = [
  ['freehand', '自由笔', 'pen'],
  ['selection', '选择', 'mouse'],
  ['lasso', '套索', 'lasso'],
  ['eraser', '橡皮擦', 'eraser'],
  ['pan', '平移', 'drag'],
];
const COLORS = [
  ['蓝', '#7FA3C3'],
  ['绿', '#8FBA8D'],
  ['黄', '#D5B984'],
  ['粉', '#CD9BAA'],
  ['紫', '#AB9CC2'],
  ['黑', '#2D2D2D'],
] as const;
const editableStyle: CSSProperties = {
  userSelect: 'text',
  WebkitUserSelect: 'text',
  WebkitTouchCallout: 'default',
};
type Panel = 'shapes' | 'drawing' | 'settings' | 'zoom';
export type ToolbarProps = {
  controller: LayeredEditorController;
  /** floating is positioned within the nearest positioned parent (normally PaintingBoard). */
  placement?: 'inline' | 'floating';
};

/** Low-frequency channels only; raw input never renders the toolbar. */
export function Toolbar({ controller, placement = 'inline' }: ToolbarProps) {
  const inputReady = useInputInitialization(controller);
  const input = useEditorSnapshot(controller, 'input');
  const { activeTool, settings } = useEditorSnapshot(controller, 'tools');
  const history = useEditorSnapshot(controller, 'history');
  const navigation = useEditorSnapshot(controller, 'navigation');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [openPanel, setOpenPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const descriptionId = useId();
  const wasCollapsed = useRef(false);
  useLayoutEffect(() => {
    if (collapsed) expandButton.current?.focus();
    else if (wasCollapsed.current) collapseButton.current?.focus();
    wasCollapsed.current = collapsed;
  }, [collapsed]);
  const freehand = activeTool === 'freehand';
  const shape = ['line', 'rect', 'ellipse', 'polygon', 'bezier'].includes(activeTool);
  const style = freehand ? settings.freehand : settings.shape;
  const currentShape = SHAPES.find(([tool]) => tool === activeTool);
  const currentDrawing = DRAWING.find(([tool]) => tool === activeTool);
  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpenPanel(null);
    if (restoreFocus) anchor.current?.focus();
  }, []);
  const togglePanel = (panel: Panel, trigger: HTMLButtonElement) => {
    anchor.current = trigger;
    setOpenPanel(openPanel === panel ? null : panel);
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
      title={label}
      aria-haspopup={panel === 'zoom' ? 'dialog' : 'menu'}
      aria-expanded={openPanel === panel || (panel === 'drawing' && openPanel === 'settings')}
      aria-controls={openPanel ? panelId : undefined}
      onClick={(event) => togglePanel(panel, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          anchor.current = event.currentTarget;
          setOpenPanel(panel);
        }
      }}
    >
      {panel === 'zoom' ? `${Math.round(viewport.scale * 100)}%` : <Icon name="chevron-down" />}
    </button>
  );
  if (!inputReady) return null;
  return (
    <div
      ref={root}
      data-toolbar-placement={placement}
      role="region"
      aria-label="绘图工具栏，可横向滚动"
      style={{
        ...(placement === 'floating'
          ? {
              position: 'absolute',
              insetInline: 0,
              bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              zIndex: 20,
              pointerEvents: 'none',
            }
          : { position: 'relative', maxWidth: '100%' }),
        display: 'flex',
        justifyContent: 'center',
        minWidth: 0,
      }}
    >
      <style>{toolbarStyles}</style>
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
          maxWidth: 'calc(100% - 32px)',
          height: collapsed ? 44 : 60,
          padding: collapsed ? 0 : '7px 12px',
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
        {collapsed ? (
          <button
            ref={expandButton}
            type="button"
            aria-label="展开工具栏"
            onClick={() => {
              setCollapsed(false);
            }}
          >
            <Icon name="chevron-up" />
          </button>
        ) : (
          <>
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
            <div className="hn-painting-group">
              <button type="button" disabled aria-describedby={descriptionId} title="OCR 暂未接入">
                <Icon name="search" /> OCR
              </button>
            </div>
            <span className="hn-painting-divider" aria-hidden="true" />
            <div className="hn-painting-group">
              <button
                type="button"
                ref={collapseButton}
                aria-label="收起工具栏"
                title="收起工具栏"
                disabled={pinned}
                onClick={() => {
                  closePanel(false);
                  setCollapsed(true);
                }}
              >
                <Icon name="chevron-down" />
              </button>
              <button
                type="button"
                aria-label="固定工具栏"
                title="固定工具栏"
                aria-pressed={pinned}
                onClick={() => setPinned(!pinned)}
              >
                <Icon name="magnet" />
              </button>
            </div>
            <span className="hn-painting-divider" aria-hidden="true" />
            <div className="hn-painting-group">
              <button
                type="button"
                aria-label="文字"
                aria-pressed={activeTool === 'text'}
                onClick={() => controller.setTool('text')}
              >
                <Icon name="type" />
                文字
              </button>
              <div className="hn-painting-group">
                <button
                  type="button"
                  aria-label={currentShape?.[1] ?? '矩形'}
                  aria-pressed={Boolean(currentShape)}
                  onClick={() => controller.setTool('rect')}
                >
                  <Icon name={currentShape?.[2] ?? 'rectangle'} />
                  {currentShape?.[1] ?? '矩形'}
                </button>
                {menuButton('shapes', '形状和对象菜单')}
              </div>
              <div className="hn-painting-group">
                <button
                  type="button"
                  aria-label={freehand || !currentDrawing ? '绘图（自由笔）' : currentDrawing[1]}
                  aria-pressed={Boolean(currentDrawing)}
                  onClick={() => controller.setTool('freehand')}
                >
                  <Icon name={currentDrawing?.[2] ?? 'pen'} />
                  {freehand || !currentDrawing ? '绘图' : currentDrawing[1]}
                </button>
                {menuButton('drawing', '绘图菜单')}
              </div>
            </div>
            <span className="hn-painting-divider" aria-hidden="true" />
            <div className="hn-painting-group" role="group" aria-label="调色板，用于绘图或形状">
              {COLORS.map(([name, color]) => {
                const selected =
                  (freehand || shape) && style.color.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
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
            </div>
          </>
        )}
      </div>
      <span id={descriptionId} hidden>
        OCR 暂未接入
      </span>
      <span id={`${descriptionId}-palette`} hidden>
        用于绘图或形状
      </span>
      {openPanel && !collapsed ? (
        <ToolbarPanel
          key={openPanel}
          id={panelId}
          label={
            { shapes: '形状和对象', drawing: '绘图', settings: '绘图设置', zoom: '缩放设置' }[
              openPanel
            ]
          }
          menu={openPanel === 'shapes' || openPanel === 'drawing'}
          anchor={anchor}
          boundary={root}
          onClose={closePanel}
        >
          {openPanel === 'shapes' || openPanel === 'drawing' ? (
            <>
              {(openPanel === 'shapes' ? SHAPES : DRAWING).map(([tool, label, icon]) => (
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
              {openPanel === 'drawing' ? (
                <button type="button" role="menuitem" onClick={() => setOpenPanel('settings')}>
                  设置
                </button>
              ) : null}
            </>
          ) : null}
          {openPanel === 'zoom' ? (
            <label>
              缩放{' '}
              <ToolbarNumberField
                label="缩放"
                min={25}
                max={800}
                step={25}
                style={{ ...editableStyle, width: 100 }}
                value={Math.round(viewport.scale * 100)}
                apply={(value) => {
                  const latest = controller.getSnapshot('viewport');
                  controller.updateViewport({
                    type: 'replace',
                    expectedRevision: latest.revision,
                    viewport: { ...latest.viewport, scale: value / 100 },
                  });
                  return Math.round(controller.getSnapshot('viewport').viewport.scale * 100);
                }}
              />
              %
            </label>
          ) : null}
          {openPanel === 'settings' ? (
            <>
              <label>
                输入模式
                <select
                  aria-label="输入模式"
                  title="输入模式"
                  value={input.mode}
                  style={{ maxWidth: '100%', minHeight: 34 }}
                  onChange={(event) => {
                    const mode = event.target.value;
                    if (!isLayeredInputMode(mode)) return;
                    if (controller.setInputMode(mode).ok) writeInputModePreference(mode);
                  }}
                >
                  <option value="auto">自动</option>
                  <option value="finger">强制手指绘制</option>
                  <option value="pen">强制手写笔绘制</option>
                </select>
              </label>
              {freehand || shape ? (
                <>
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
                  <label>
                    笔宽{' '}
                    <ToolbarNumberField
                      label="笔宽"
                      min={0.5}
                      max={200}
                      step={0.5}
                      style={{ ...editableStyle, width: 56 }}
                      value={freehand ? settings.freehand.nominalSize : settings.shape.width}
                      apply={(width) => {
                        updateStyle({ width });
                        const current = controller.getSnapshot('tools').settings;
                        return freehand ? current.freehand.nominalSize : current.shape.width;
                      }}
                    />
                  </label>
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
                <label>
                  压力{' '}
                  <select
                    aria-label="压力模式"
                    value={settings.freehand.pressureMode}
                    onChange={(event) =>
                      controller.setFreehandSettings({
                        ...settings.freehand,
                        pressureMode: event.target.value as PressureMode,
                      })
                    }
                  >
                    <option value="auto">自动</option>
                    <option value="real">真实</option>
                    <option value="simulated">模拟</option>
                    <option value="constant">恒定</option>
                  </select>
                </label>
              ) : null}
              {shape ? (
                <label>
                  线型{' '}
                  <select
                    aria-label="形状线型"
                    value={settings.shape.dash?.length ? 'dash' : 'solid'}
                    onChange={(event) =>
                      controller.setShapeSettings({
                        ...settings.shape,
                        dash: event.target.value === 'dash' ? [8, 5] : [],
                      })
                    }
                  >
                    <option value="solid">实线</option>
                    <option value="dash">虚线</option>
                  </select>
                </label>
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
