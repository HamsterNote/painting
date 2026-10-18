import { Icon, type IconName } from '@hamster-note/components';
import type { CSSProperties } from 'react';
import type { LayeredEditorController, LayeredEditorTool } from '../core/layeredEditorController';
import type { PressureMode } from '../model/document';
import { useEditorSnapshot } from './useEditorSnapshot';
import { useInputInitialization } from './useInputInitialization';
import { isLayeredInputMode } from '../core/layeredInputMode';
import { writeInputModePreference } from './inputModePreference';

const TOOLS: readonly [LayeredEditorTool, string, IconName][] = [
  ['freehand', '自由笔', 'pen'],
  ['line', '直线', 'line'],
  ['rect', '矩形', 'rectangle'],
  ['ellipse', '椭圆', 'ellipse'],
  ['polygon', '多边形', 'polygon'],
  ['bezier', '贝塞尔', 'curve'],
  ['text', '文字', 'type'],
  ['image', '图片', 'image'],
  ['selection', '选择', 'mouse'],
  ['lasso', '套索', 'lasso'],
  ['eraser', '橡皮擦', 'eraser'],
  ['pan', '平移', 'drag'],
];

const buttonStyle: CSSProperties = {
  width: 34,
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  color: '#20262d',
};

/** Low-frequency channels only; raw input never renders the toolbar. */
export function Toolbar({ controller }: { controller: LayeredEditorController }) {
  const inputReady = useInputInitialization(controller);
  const input = useEditorSnapshot(controller, 'input');
  const { activeTool, settings } = useEditorSnapshot(controller, 'tools');
  const history = useEditorSnapshot(controller, 'history');
  const navigation = useEditorSnapshot(controller, 'navigation');
  const { viewport, revision } = useEditorSnapshot(controller, 'viewport');
  const freehand = activeTool === 'freehand';
  const shape = ['line', 'rect', 'ellipse', 'polygon', 'bezier'].includes(activeTool);
  const style = freehand ? settings.freehand : settings.shape;
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
  if (!inputReady) return null;
  return (
    <div
      role="toolbar"
      aria-label="绘图工具"
      data-input-mode={input.mode}
      data-interactive="true"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: 8,
        borderBottom: '1px solid #d1d5db',
        background: '#f9fafb',
        color: '#20262d',
        fontSize: 13,
      }}
    >
      {TOOLS.map(([tool, label, icon]) => (
        <button
          key={tool}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={activeTool === tool}
          onClick={() => controller.setTool(tool)}
          style={{ ...buttonStyle, background: activeTool === tool ? '#d1fae5' : '#fff' }}
        >
          <Icon name={icon} style={{ width: 18, height: 18 }} />
        </button>
      ))}
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
      <button
        type="button"
        title="撤销"
        aria-label="撤销"
        style={buttonStyle}
        disabled={!history.canUndo}
        onClick={() => controller.undo()}
      >
        <Icon name="undo" style={{ width: 18, height: 18 }} />
      </button>
      <button
        type="button"
        title="重做"
        aria-label="重做"
        style={buttonStyle}
        disabled={!history.canRedo}
        onClick={() => controller.redo()}
      >
        <Icon name="redo" style={{ width: 18, height: 18 }} />
      </button>
      {freehand || shape ? (
        <>
          <input
            type="color"
            aria-label="颜色"
            title="颜色"
            value={style.color}
            onChange={(event) => updateStyle({ color: event.target.value })}
          />
          <label>
            笔宽{' '}
            <input
              aria-label="笔宽"
              type="number"
              min={0.5}
              max={200}
              step={0.5}
              style={{ width: 56 }}
              value={freehand ? settings.freehand.nominalSize : settings.shape.width}
              onChange={(event) => updateStyle({ width: event.target.valueAsNumber })}
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
      <label>
        缩放{' '}
        <input
          aria-label="缩放"
          type="number"
          min={25}
          max={800}
          step={25}
          value={Math.round(viewport.scale * 100)}
          style={{ width: 60 }}
          onChange={(event) =>
            controller.updateViewport({
              type: 'replace',
              expectedRevision: revision,
              viewport: { ...viewport, scale: event.target.valueAsNumber / 100 },
            })
          }
        />
        %
      </label>
    </div>
  );
}
