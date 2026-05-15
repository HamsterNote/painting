import { useState, useCallback } from 'react';
import { DrawingSurface } from '@hamster-note/painting';
import type { DrawingValue } from '@hamster-note/painting';

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

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '400px' }}>
          <h2>Uncontrolled (defaultValue)</h2>
          <div style={{ width: '400px', height: '300px', marginBottom: '10px' }}>
            <DrawingSurface
              defaultValue={uncontrolledStrokes}
              onChange={handleUncontrolledChange}
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
