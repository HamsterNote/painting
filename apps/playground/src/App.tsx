import { DrawingSurface, type DrawingTool, type DrawingInputMethod, type DrawingValue, type DrawingStrokeSmoothingOptions } from '@hamster-note/painting';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** 所有可用工具 (Tasks 7-13 完成后的完整工具集) */
const ALL_TOOLS: { value: DrawingTool; label: string }[] = [
  { value: 'pen', label: 'Pen' },
  { value: 'line', label: 'Line' },
  { value: 'rect', label: 'Rect' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'bezier', label: 'Bezier' },
  { value: 'eraser', label: 'Eraser' },
];

/**
 * 工具使用说明映射 — Playwright 可断言这些文本以验证说明可见。
 * rect/ellipse 支持 Shift 约束；line/polygon/bezier 是 click-to-place 工具。
 */
function getToolInstruction(tool: DrawingTool): string | null {
  switch (tool) {
    case 'rect':
    case 'ellipse':
      return 'Hold Shift to draw square/circle';
    case 'line':
    case 'polygon':
    case 'bezier':
      return 'Click to add points, double-click or Esc to finish';
    default:
      return null;
  }
}

/**
 * 采样率测试 Demo 统计数据
 */
interface SamplingDemoResult {
  /** 唯一标识 */
  id: string;
  /** 指针类型 */
  pointerType: 'mouse' | 'touch' | 'pen';
  /** 总事件数（down + move + up） */
  totalEvents: number;
  /** move 事件数 */
  moveCount: number;
  /** down + up 事件数 */
  boundaryCount: number;
  /** 从按下到抬起的总时间 (ms) */
  totalTime: number;
  /** move 事件采样率 (events/sec) */
  moveRate: number;
  /** 平均 move 间隔 (ms) */
  avgMoveInterval: number;
}

interface RawSamplingDemoResult {
  id: string;
  pointerType: 'mouse' | 'touch' | 'pen';
  pointerMoveCount: number;
  pointerRawUpdateCount: number;
  coalescedPointsCount: number;
  totalTime: number;
  pointerMoveRate: number;
  pointerRawUpdateRate: number;
  coalescedPointsRate: number;
  supportsRawUpdate: boolean;
  supportsCoalescedEvents: boolean;
}

const SEED_VALUE: DrawingValue = {
  strokes: [
    {
      id: 'seed-1',
      tool: 'pen',
      points: [
        { x: 50, y: 50 },
        { x: 100, y: 100 },
        { x: 150, y: 80 },
      ],
    },
  ],
};

export default function App() {
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(2);
  const [pressure, setPressure] = useState(false);
  const [inputMethods, setInputMethods] = useState<DrawingInputMethod[]>(['touch', 'mouse', 'pen']);
  const [samplingRate, setSamplingRate] = useState(0);
  const [smoothingEnabled, setSmoothingEnabled] = useState(true);
  const [smoothingStrength, setSmoothingStrength] = useState(0.5);
  const [smoothingDensity, setSmoothingDensity] = useState(1);
  const [smoothingVelocityThreshold, setSmoothingVelocityThreshold] = useState(0.5);
  const [controlledValue, setControlledValue] = useState<DrawingValue>({ strokes: [] });
  const [uncontrolledStrokes, setUncontrolledStrokes] = useState<DrawingValue>(SEED_VALUE);

  // ===== Dash 控制状态 (Task 8/9 dashArray + dashOffset) =====
  const [dashEnabled, setDashEnabled] = useState(false);
  const [dashLength, setDashLength] = useState(10);
  const [dashGap, setDashGap] = useState(5);
  const [dashOffset, setDashOffset] = useState(0);

  // ===== Fill 控制状态 (closed shapes: rect/ellipse/polygon) =====
  const [fillEnabled, setFillEnabled] = useState(false);
  const [fillColor, setFillColor] = useState('#4a90d9');
  const [fillOpacity, setFillOpacity] = useState(0.5);
  // 闭合形状允许 strokeWidth=0（纯填充无描边），此 toggle 强制 strokeWidth=0
  const [forceStrokeWidthZero, setForceStrokeWidthZero] = useState(false);

  // ===== Cursor 控制状态 (Task 12) =====
  const [cursorEnabled, setCursorEnabled] = useState(true);
  const [cursorCustomRender, setCursorCustomRender] = useState(false);

  // ===== Gestures 控制状态 (Task 13: pan / pinchZoom / reset 独立开关) =====
  const [gesturePan, setGesturePan] = useState(false);
  const [gesturePinchZoom, setGesturePinchZoom] = useState(false);
  const [gestureReset, setGestureReset] = useState(false);
  // 当 reset 启用时显示 reset 按钮；按钮点击触发 viewportResetCounter 自增，
  // 通过 key 重挂载子组件来命令式重置（避免引入 imperative ref 接口）
  const [viewportResetCounter, setViewportResetCounter] = useState(0);

  // ===== 采样率测试 Demo 状态 =====
  const [samplingDemoResults, setSamplingDemoResults] = useState<SamplingDemoResult[]>([]);
  const samplingDemoRef = useRef<{
    isPressed: boolean;
    startTime: number;
    moveCount: number;
    totalEvents: number;
    pointerType: 'mouse' | 'touch' | 'pen';
    moveTimestamps: number[];
  }>({
    isPressed: false,
    startTime: 0,
    moveCount: 0,
    totalEvents: 0,
    pointerType: 'mouse',
    moveTimestamps: [],
  });

  // ===== pointerrawupdate 测试 Demo 状态 =====
  const [rawSamplingDemoResults, setRawSamplingDemoResults] = useState<RawSamplingDemoResult[]>([]);
  const rawSamplingDemoRef = useRef<{
    isPressed: boolean;
    startTime: number;
    pointerMoveCount: number;
    pointerRawUpdateCount: number;
    coalescedPointsCount: number;
    pointerType: 'mouse' | 'touch' | 'pen';
    supportsRawUpdate: boolean;
    supportsCoalescedEvents: boolean;
  }>({
    isPressed: false,
    startTime: 0,
    pointerMoveCount: 0,
    pointerRawUpdateCount: 0,
    coalescedPointsCount: 0,
    pointerType: 'mouse',
    supportsRawUpdate: false,
    supportsCoalescedEvents: false,
  });
  const rawSamplingAreaRef = useRef<HTMLDivElement>(null);

  const handleControlledChange = useCallback((nextValue: DrawingValue) => {
    setControlledValue(nextValue);
  }, []);

  const handleUncontrolledChange = useCallback((nextValue: DrawingValue) => {
    setUncontrolledStrokes(nextValue);
  }, []);

  const handleReset = useCallback(() => {
    setControlledValue({ strokes: [] });
  }, []);

  // ===== 采样率测试 Demo 事件处理 =====
  const handleSamplingDemoPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = samplingDemoRef.current;
    ref.isPressed = true;
    ref.startTime = e.timeStamp;
    ref.moveCount = 0;
    ref.totalEvents = 1; // pointerdown 本身
    ref.pointerType = e.pointerType as 'mouse' | 'touch' | 'pen';
    ref.moveTimestamps = [e.timeStamp];
  }, []);

  const handleSamplingDemoPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = samplingDemoRef.current;
    if (!ref.isPressed) return;
    ref.moveCount++;
    ref.totalEvents++;
    ref.moveTimestamps.push(e.timeStamp);
  }, []);

  const handleSamplingDemoPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = samplingDemoRef.current;
    if (!ref.isPressed) return;
    ref.isPressed = false;
    ref.totalEvents++; // pointerup 本身

    // 计算总时间
    const totalTime = e.timeStamp - ref.startTime;
    const boundaryCount = 2; // down + up
    const moveRate = totalTime > 0 ? (ref.moveCount / totalTime) * 1000 : 0;
    
    // 计算平均 move 间隔
    let avgMoveInterval = 0;
    if (ref.moveTimestamps.length > 1) {
      let totalInterval = 0;
      for (let i = 1; i < ref.moveTimestamps.length; i++) {
        totalInterval += ref.moveTimestamps[i] - ref.moveTimestamps[i - 1];
      }
      avgMoveInterval = totalInterval / (ref.moveTimestamps.length - 1);
    }

    // 保留最近 20 条记录，每条记录附加唯一ID
    const result: SamplingDemoResult & { id: string } = {
      pointerType: ref.pointerType,
      totalEvents: ref.totalEvents,
      moveCount: ref.moveCount,
      boundaryCount,
      totalTime,
      moveRate,
      avgMoveInterval,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    setSamplingDemoResults((prev) => [result, ...prev].slice(0, 20));
  }, []);

  const handleRawSamplingPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = rawSamplingDemoRef.current;
    ref.isPressed = true;
    ref.startTime = e.timeStamp;
    ref.pointerMoveCount = 0;
    ref.pointerRawUpdateCount = 0;
    ref.coalescedPointsCount = 0;
    ref.pointerType = e.pointerType as 'mouse' | 'touch' | 'pen';
    ref.supportsRawUpdate = 'onpointerrawupdate' in HTMLElement.prototype;
    ref.supportsCoalescedEvents = typeof (e.nativeEvent as PointerEvent).getCoalescedEvents === 'function';
  }, []);

  const handleRawSamplingPointerMove = useCallback((_e: React.PointerEvent<HTMLDivElement>) => {
    // React 合成事件不暴露 getCoalescedEvents，因此实际计数在 useEffect 的原生 pointermove 监听器中处理
    // 此处保留空回调是为了让 React 不会优化掉该事件的合成事件绑定
  }, []);

  const handleRawSamplingPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = rawSamplingDemoRef.current;
    if (!ref.isPressed) return;
    ref.isPressed = false;

    const totalTime = e.timeStamp - ref.startTime;
    const pointerMoveRate = totalTime > 0 ? (ref.pointerMoveCount / totalTime) * 1000 : 0;
    const pointerRawUpdateRate = totalTime > 0 ? (ref.pointerRawUpdateCount / totalTime) * 1000 : 0;
    const coalescedPointsRate = totalTime > 0 ? (ref.coalescedPointsCount / totalTime) * 1000 : 0;

    const result: RawSamplingDemoResult = {
      pointerType: ref.pointerType,
      pointerMoveCount: ref.pointerMoveCount,
      pointerRawUpdateCount: ref.pointerRawUpdateCount,
      coalescedPointsCount: ref.coalescedPointsCount,
      totalTime,
      pointerMoveRate,
      pointerRawUpdateRate,
      coalescedPointsRate,
      supportsRawUpdate: ref.supportsRawUpdate,
      supportsCoalescedEvents: ref.supportsCoalescedEvents,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    setRawSamplingDemoResults((prev) => [result, ...prev].slice(0, 20));
  }, []);

  useEffect(() => {
    const area = rawSamplingAreaRef.current;
    if (!area) return;

    const moveHandler = (event: Event) => {
      const e = event as PointerEvent;
      if (!rawSamplingDemoRef.current.isPressed) return;

      rawSamplingDemoRef.current.pointerMoveCount++;

      if (typeof e.getCoalescedEvents === 'function') {
        const coalescedEvents = e.getCoalescedEvents();
        rawSamplingDemoRef.current.coalescedPointsCount += coalescedEvents.length;
      } else {
        rawSamplingDemoRef.current.coalescedPointsCount++;
      }
    };

    area.addEventListener('pointermove', moveHandler);
    return () => {
      area.removeEventListener('pointermove', moveHandler);
    };
  }, []);

  const handleInputMethodToggle = useCallback((method: DrawingInputMethod) => {
    setInputMethods((prev) =>
      prev.includes(method)
        ? prev.filter((m) => m !== method)
        : [...prev, method]
    );
  }, []);

  const strokeSmoothing: boolean | DrawingStrokeSmoothingOptions = smoothingEnabled
    ? {
        enabled: true,
        strength: smoothingStrength,
        density: smoothingDensity,
        velocityThreshold: smoothingVelocityThreshold,
      }
    : false;

  const controlledStrokes = controlledValue;

  // dashArray: [length, gap] when enabled; undefined for solid stroke
  const dashArray = dashEnabled ? [dashLength, dashGap] : undefined;
  const resolvedDashOffset = dashEnabled ? dashOffset : undefined;

  // strokeWidth=0 toggle allows fill-only closed shapes
  const effectiveStrokeWidth = forceStrokeWidthZero ? 0 : width;

  // fill props only applied when fillEnabled
  const resolvedFillColor = fillEnabled ? fillColor : undefined;
  const resolvedFillOpacity = fillEnabled ? fillOpacity : undefined;

  // cursor: false disables overlay; object enables custom render demo; undefined uses default crosshair
  const cursorProp: false | { size?: number; color?: string; render?: (state: { screen: { x: number; y: number }; visible: boolean; activeTool: DrawingTool }) => ReactNode } | undefined =
    !cursorEnabled
      ? false
      : cursorCustomRender
      ? {
          size: 20,
          color: '#ff6600',
          render: (state) => {
            if (!state.visible) return null;
            const s = state.screen;
            // 自定义渲染示例：橘色小圆点 + 工具名标签
            return (
              <g data-testid="cursor-custom-render">
                <circle cx={s.x} cy={s.y} r={4} fill="#ff6600" opacity={0.7} />
                <text x={s.x + 10} y={s.y - 6} fontSize={10} fill="#ff6600">
                  {state.activeTool}
                </text>
              </g>
            );
          },
        }
      : undefined;

  const gesturesProp = {
    pan: gesturePan,
    pinchZoom: gesturePinchZoom,
    reset: gestureReset,
  };

  const handleViewportReset = useCallback(() => {
    setViewportResetCounter((n) => n + 1);
  }, []);

  const toolInstruction = getToolInstruction(tool);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1 style={{ marginBottom: '20px' }}>DrawingSurface Playground</h1>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <label>
          Tool{' '}
          <select
            data-testid="drawing-tool-select"
            value={tool}
            onChange={(e) => setTool(e.target.value as DrawingTool)}
          >
            {ALL_TOOLS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {ALL_TOOLS.map((t) => (
          <button
            key={t.value}
            type="button"
            data-tool={t.value}
            onClick={() => setTool(t.value)}
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              border: tool === t.value ? '2px solid #333' : '1px solid #aaa',
              background: tool === t.value ? '#e0e0e0' : '#fff',
              borderRadius: '3px',
            }}
          >
            {t.label}
          </button>
        ))}

        {toolInstruction && (
          <span data-testid="tool-instruction" style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
            {toolInstruction}
          </span>
        )}

        <label>
          Color{' '}
          <input
            type="color"
            data-testid="drawing-stroke-color-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <label>
          Width{' '}
          <input
            type="number"
            data-testid="drawing-stroke-width-input"
            value={width}
            min={1}
            max={24}
            onChange={(e) =>
              setWidth(Math.min(24, Math.max(1, parseInt(e.target.value, 10) || 1)))
            }
          />
        </label>

        <label>
          Pressure{' '}
          <input
            type="checkbox"
            data-testid="drawing-pressure-toggle"
            checked={pressure}
            onChange={(e) => setPressure(e.target.checked)}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            data-testid="drawing-input-method-touch"
            checked={inputMethods.includes('touch')}
            onChange={() => handleInputMethodToggle('touch')}
          />
          Touch
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            data-testid="drawing-input-method-mouse"
            checked={inputMethods.includes('mouse')}
            onChange={() => handleInputMethodToggle('mouse')}
          />
          Mouse
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            data-testid="drawing-input-method-pen"
            checked={inputMethods.includes('pen')}
            onChange={() => handleInputMethodToggle('pen')}
          />
          Pen
        </label>

        <label>
          Sampling Rate{' '}
          <input
            type="number"
            data-testid="drawing-sampling-rate-input"
            value={samplingRate}
            min={0}
            max={240}
            onChange={(e) =>
              setSamplingRate(Math.min(240, Math.max(0, parseInt(e.target.value, 10) || 0)))
            }
          />
          <span style={{ fontSize: '12px', color: '#666' }}>fps (0=auto)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            data-testid="drawing-smoothing-toggle"
            checked={smoothingEnabled}
            onChange={(e) => setSmoothingEnabled(e.target.checked)}
          />
          Smoothing
        </label>

        {smoothingEnabled && (
          <>
            <label>
              Strength{' '}
              <input
                type="range"
                data-testid="drawing-smoothing-strength"
                min={0}
                max={1}
                step={0.1}
                value={smoothingStrength}
                onChange={(e) => setSmoothingStrength(parseFloat(e.target.value))}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>{smoothingStrength.toFixed(1)}</span>
            </label>

            <label>
              Density{' '}
              <input
                type="range"
                data-testid="drawing-smoothing-density"
                min={0.1}
                max={3}
                step={0.1}
                value={smoothingDensity}
                onChange={(e) => setSmoothingDensity(parseFloat(e.target.value))}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>{smoothingDensity.toFixed(1)}</span>
            </label>

            <label>
              Velocity{' '}
              <input
                type="range"
                data-testid="drawing-smoothing-velocity"
                min={0}
                max={2}
                step={0.1}
                value={smoothingVelocityThreshold}
                onChange={(e) => setSmoothingVelocityThreshold(parseFloat(e.target.value))}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>{smoothingVelocityThreshold.toFixed(1)}</span>
            </label>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
      <fieldset data-testid="panel-dash" style={{ margin: 0, border: '1px solid #ccc', borderRadius: '4px', padding: '8px 12px', flex: '1 1 320px' }}>
        <legend><strong>Dash</strong></legend>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              data-testid="dash-enabled"
              checked={dashEnabled}
              onChange={(e) => setDashEnabled(e.target.checked)}
            />
            {' '}Enable
          </label>
          <label>
            Length{' '}
            <input
              type="number"
              data-testid="dash-length"
              min={0}
              max={100}
              value={dashLength}
              onChange={(e) => setDashLength(Math.max(0, parseInt(e.target.value, 10) || 0))}
              style={{ width: '60px' }}
            />
          </label>
          <label>
            Gap{' '}
            <input
              type="number"
              data-testid="dash-gap"
              min={0}
              max={100}
              value={dashGap}
              onChange={(e) => setDashGap(Math.max(0, parseInt(e.target.value, 10) || 0))}
              style={{ width: '60px' }}
            />
          </label>
          <label>
            Offset{' '}
            <input
              type="number"
              data-testid="dash-offset"
              min={-100}
              max={100}
              value={dashOffset}
              onChange={(e) => setDashOffset(parseInt(e.target.value, 10) || 0)}
              style={{ width: '60px' }}
            />
          </label>
        </div>
      </fieldset>

      <fieldset data-testid="panel-fill" style={{ margin: 0, border: '1px solid #ccc', borderRadius: '4px', padding: '8px 12px', flex: '1 1 320px' }}>
        <legend><strong>Fill (closed shapes: rect / ellipse / polygon)</strong></legend>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              data-testid="fill-enabled"
              checked={fillEnabled}
              onChange={(e) => setFillEnabled(e.target.checked)}
            />
            {' '}Enable
          </label>
          <label>
            Color{' '}
            <input
              type="color"
              data-testid="fill-color"
              value={fillColor}
              onChange={(e) => setFillColor(e.target.value)}
            />
          </label>
          <label>
            Opacity{' '}
            <input
              type="range"
              data-testid="fill-opacity"
              min={0}
              max={1}
              step={0.05}
              value={fillOpacity}
              onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '12px', color: '#666' }}>{fillOpacity.toFixed(2)}</span>
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="force-stroke-width-zero"
              checked={forceStrokeWidthZero}
              onChange={(e) => setForceStrokeWidthZero(e.target.checked)}
            />
            {' '}strokeWidth = 0 (fill only)
          </label>
        </div>
      </fieldset>

      <fieldset data-testid="panel-cursor" style={{ margin: 0, border: '1px solid #ccc', borderRadius: '4px', padding: '8px 12px', flex: '1 1 320px' }}>
        <legend><strong>Cursor / Crosshair</strong></legend>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              data-testid="cursor-enabled"
              checked={cursorEnabled}
              onChange={(e) => setCursorEnabled(e.target.checked)}
            />
            {' '}Enable crosshair
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="cursor-custom-render-toggle"
              checked={cursorCustomRender}
              onChange={(e) => setCursorCustomRender(e.target.checked)}
              disabled={!cursorEnabled}
            />
            {' '}Use custom render (orange dot + tool label)
          </label>
        </div>
      </fieldset>

      <fieldset data-testid="panel-gestures" style={{ margin: 0, border: '1px solid #ccc', borderRadius: '4px', padding: '8px 12px', flex: '1 1 320px' }}>
        <legend><strong>Gestures (viewport pan / pinch zoom / reset)</strong></legend>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              data-testid="gesture-pan-toggle"
              checked={gesturePan}
              onChange={(e) => setGesturePan(e.target.checked)}
            />
            {' '}Pan
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="gesture-pinch-zoom-toggle"
              checked={gesturePinchZoom}
              onChange={(e) => setGesturePinchZoom(e.target.checked)}
            />
            {' '}Pinch Zoom
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="gesture-reset-toggle"
              checked={gestureReset}
              onChange={(e) => setGestureReset(e.target.checked)}
            />
            {' '}Reset
          </label>
          {gestureReset && (
            <button
              type="button"
              data-testid="gesture-reset-button"
              onClick={handleViewportReset}
              style={{ padding: '4px 10px', cursor: 'pointer' }}
            >
              Reset viewport
            </button>
          )}
        </div>
      </fieldset>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '400px' }}>
          <h2>Uncontrolled (defaultValue)</h2>
          <div style={{ width: '400px', height: '300px', marginBottom: '10px' }}>
            <DrawingSurface
              key={`uncontrolled-${viewportResetCounter}`}
              defaultValue={uncontrolledStrokes}
              onChange={handleUncontrolledChange}
              tool={tool}
              strokeColor={color}
              strokeWidth={effectiveStrokeWidth}
              pressure={pressure}
              inputMethods={inputMethods}
              samplingRate={samplingRate}
              strokeSmoothing={strokeSmoothing}
              dashArray={dashArray}
              dashOffset={resolvedDashOffset}
              fillColor={resolvedFillColor}
              fillOpacity={resolvedFillOpacity}
              cursor={cursorProp}
              gestures={gesturesProp}
              testID="drawing-surface-uncontrolled"
            />
          </div>
          <pre
            data-testid="drawing-preview-uncontrolled"
            style={{
              width: '400px',
              maxHeight: '200px',
              overflow: 'auto',
              backgroundColor: '#f5f5f5',
              padding: '10px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            {JSON.stringify(uncontrolledStrokes, null, 2)}
          </pre>
        </div>

        <div style={{ flex: 1, minWidth: '400px' }}>
          <h2>Controlled (value + onChange)</h2>
          <div style={{ width: '400px', height: '300px', marginBottom: '10px' }}>
            <DrawingSurface
              key={`controlled-${viewportResetCounter}`}
              value={controlledStrokes}
              onChange={handleControlledChange}
              tool={tool}
              strokeColor={color}
              strokeWidth={effectiveStrokeWidth}
              pressure={pressure}
              inputMethods={inputMethods}
              samplingRate={samplingRate}
              strokeSmoothing={strokeSmoothing}
              dashArray={dashArray}
              dashOffset={resolvedDashOffset}
              fillColor={resolvedFillColor}
              fillOpacity={resolvedFillOpacity}
              cursor={cursorProp}
              gestures={gesturesProp}
              testID="drawing-surface-controlled"
            />
          </div>
          <button
            type="button"
            data-testid="drawing-reset-controlled"
            onClick={handleReset}
            style={{
              marginBottom: '10px',
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
          <pre
            data-testid="drawing-preview-controlled"
            style={{
              width: '400px',
              maxHeight: '200px',
              overflow: 'auto',
              backgroundColor: '#f5f5f5',
              padding: '10px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            {JSON.stringify(controlledStrokes, null, 2)}
          </pre>
        </div>
      </div>

      {/* ===== 采样率测试 Demo ===== */}
      <div style={{ marginTop: '30px', borderTop: '1px solid #ddd', paddingTop: '20px' }}>
        <h2>采样率测试 Demo</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          在下方区域按下鼠标/触摸/手写笔并移动，抬起后查看事件统计。
        </p>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {/* 交互区域 */}
          <div
            data-testid="sampling-demo-area"
            onPointerDown={handleSamplingDemoPointerDown}
            onPointerMove={handleSamplingDemoPointerMove}
            onPointerUp={handleSamplingDemoPointerUp}
            style={{
              width: '400px',
              height: '300px',
              border: '2px dashed #aaa',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'crosshair',
              userSelect: 'none',
              touchAction: 'none', // 阻止触摸默认行为
              backgroundColor: '#fafafa',
            }}
          >
            <span style={{ color: '#999', fontSize: '16px', pointerEvents: 'none' }}>
              在此处绘制
            </span>
          </div>

          {/* 结果面板 */}
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3 style={{ marginBottom: '12px' }}>事件统计（最近 {samplingDemoResults.length} 次）</h3>
            
            {samplingDemoResults.length === 0 ? (
              <p style={{ color: '#999' }}>尚无数据，请在左侧区域绘制</p>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                {samplingDemoResults.map((result, index) => (
                  <div
                    key={result.id}
                    data-testid={`sampling-demo-result-${index}`}
                    style={{
                      padding: '10px',
                      marginBottom: '8px',
                      backgroundColor: index === 0 ? '#e8f5e9' : '#f5f5f5',
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                    }}
                  >
                    <div><strong>#{samplingDemoResults.length - index}</strong> | 类型: {result.pointerType}</div>
                    <div>总事件数: <strong>{result.totalEvents}</strong>（down 1 + move {result.moveCount} + up 1）</div>
                    <div>move 事件数: <strong>{result.moveCount}</strong></div>
                    <div>总时间: <strong>{result.totalTime.toFixed(1)} ms</strong></div>
                    <div>move 采样率: <strong>{result.moveRate.toFixed(1)} events/sec</strong></div>
                    <div>平均 move 间隔: <strong>{result.avgMoveInterval.toFixed(2)} ms</strong></div>
                  </div>
                ))}
              </div>
            )}

            {samplingDemoResults.length > 0 && (
              <button
                type="button"
                onClick={() => setSamplingDemoResults([])}
                style={{
                  marginTop: '10px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                清除历史
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== getCoalescedEvents 采样率测试 Demo ===== */}
      <div style={{ marginTop: '30px', borderTop: '1px solid #ddd', paddingTop: '20px' }}>
        <h2>getCoalescedEvents 采样率测试</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          测试 pointermove 事件中 getCoalescedEvents() 返回的合并点数，验证是否能获取更高频率的采样数据。
        </p>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div
            ref={rawSamplingAreaRef}
            data-testid="raw-sampling-demo-area"
            onPointerDown={handleRawSamplingPointerDown}
            onPointerMove={handleRawSamplingPointerMove}
            onPointerUp={handleRawSamplingPointerUp}
            style={{
              width: '400px',
              height: '300px',
              border: '2px dashed #aaa',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'crosshair',
              userSelect: 'none',
              touchAction: 'none',
              backgroundColor: '#fafafa',
            }}
          >
            <span style={{ color: '#999', fontSize: '16px', pointerEvents: 'none' }}>
              在此处绘制
            </span>
          </div>

          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3 style={{ marginBottom: '12px' }}>事件统计（最近 {rawSamplingDemoResults.length} 次）</h3>
            
            {rawSamplingDemoResults.length === 0 ? (
              <p style={{ color: '#999' }}>尚无数据，请在左侧区域绘制</p>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                {rawSamplingDemoResults.map((result, index) => (
                  <div
                    key={result.id}
                    data-testid={`raw-sampling-demo-result-${index}`}
                    style={{
                      padding: '10px',
                      marginBottom: '8px',
                      backgroundColor: index === 0 ? '#e3f2fd' : '#f5f5f5',
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                    }}
                  >
                    <div><strong>#{rawSamplingDemoResults.length - index}</strong> | 类型: {result.pointerType}</div>
                    <div>pointermove 事件数: <strong>{result.pointerMoveCount}</strong> ({result.pointerMoveRate.toFixed(1)} events/sec)</div>
                    <div>coalesced 总点数: <strong>{result.coalescedPointsCount}</strong> ({result.coalescedPointsRate.toFixed(1)} points/sec)</div>
                    {result.pointerMoveCount > 0 && (
                      <div>平均每次 move 合并点数: <strong>{(result.coalescedPointsCount / result.pointerMoveCount).toFixed(1)}</strong></div>
                    )}
                    <div>总时间: <strong>{result.totalTime.toFixed(1)} ms</strong></div>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                      支持 pointerrawupdate: {result.supportsRawUpdate ? '✓' : '✗'} | 支持 getCoalescedEvents: {result.supportsCoalescedEvents ? '✓' : '✗'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rawSamplingDemoResults.length > 0 && (
              <button
                type="button"
                onClick={() => setRawSamplingDemoResults([])}
                style={{
                  marginTop: '10px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                清除历史
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
