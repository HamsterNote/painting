import HamsterPainting from '@hamster-note/painting';
import React, { useState } from 'react';

export default function App() {
  const [strokeCount, setStrokeCount] = useState(0);

  return (
    <div style={styles.container}>
      <h1 style={styles.text}>Playground Ready</h1>
      <p data-testid="hamster-painting-stroke-count">Stroke Count: {strokeCount}</p>
      <p data-testid="hamster-painting-status">{strokeCount > 0 ? 'Drawn' : 'Idle'}</p>
      <div style={styles.surfaceSlot} data-testid="drawing-surface-smoke">
        <HamsterPainting onStrokeCountChange={setStrokeCount} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#fff',
    padding: '20px',
    margin: 0,
  },
  text: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
  },
  surfaceSlot: {
    width: '300px',
    height: '300px',
    border: '1px solid #ccc',
  },
};
