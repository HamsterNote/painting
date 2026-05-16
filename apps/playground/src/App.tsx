import { DrawingSurface, type DrawingTool, type DrawingValue } from '@hamster-note/painting';
import { useCallback, useState } from 'react';

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
  const [controlledValue, setControlledValue] = useState<DrawingValue>({ strokes: [] });
  const [uncontrolledStrokes, setUncontrolledStrokes] = useState<DrawingValue>(SEED_VALUE);

  const handleControlledChange = useCallback((nextValue: DrawingValue) => {
    setControlledValue(nextValue);
  }, []);

  const handleUncontrolledChange = useCallback((nextValue: DrawingValue) => {
    setUncontrolledStrokes(nextValue);
  }, []);

  const handleReset = useCallback(() => {
    setControlledValue({ strokes: [] });
  }, []);

  const controlledStrokes = controlledValue;

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
            <option value="pen">Pen</option>
            <option value="line">Line</option>
            <option value="rect">Rect</option>
            <option value="eraser">Eraser</option>
          </select>
        </label>

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
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '400px' }}>
          <h2>Uncontrolled (defaultValue)</h2>
          <div style={{ width: '400px', height: '300px', marginBottom: '10px' }}>
            <DrawingSurface
              defaultValue={uncontrolledStrokes}
              onChange={handleUncontrolledChange}
              tool={tool}
              strokeColor={color}
              strokeWidth={width}
              pressure={pressure}
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
              value={controlledStrokes}
              onChange={handleControlledChange}
              tool={tool}
              strokeColor={color}
              strokeWidth={width}
              pressure={pressure}
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
    </div>
  );
}
