import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayeredPaintingBoard, createEditor } from '@hamster-note/painting-board';
import { files, useFixtureHost } from './shared';

function Fixture() {
  const host = useFixtureHost();
  const [controller] = useState(() => createEditor());
  const legacy = new URLSearchParams(window.location.search).has('legacy');
  return (
    <>
      {host.controls}
      <div data-testid="painting" style={{ height: 650, width: '100%' }}>
        <LayeredPaintingBoard
          controller={controller}
          files={legacy ? undefined : files}
          currentFileKey={host.current}
          paneId="primary"
          onSelectFile={host.onSelectFile}
          layout={legacy ? undefined : host.layout}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
