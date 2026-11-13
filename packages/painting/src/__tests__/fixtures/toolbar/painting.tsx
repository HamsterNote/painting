import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayeredPaintingBoard, createEditor } from '@hamster-note/painting-board';
import { files, useFixtureHost } from './shared';

function Fixture() {
  const host = useFixtureHost();
  const [controller] = useState(() => createEditor());
  const [secondary] = useState(() => createEditor());
  const split = new URLSearchParams(window.location.search).has('split');
  const inline = new URLSearchParams(window.location.search).has('inline');
  const legacy = new URLSearchParams(window.location.search).has('legacy');
  const long = new URLSearchParams(window.location.search).has('long');
  const remove = new URLSearchParams(window.location.search).has('remove');
  const fixtureFiles = long
    ? files.map((file, index) => ({
        ...file,
        displayName:
          index === 0 ? `${'这是需要完整显示的中文文件名'.repeat(8)}.pdf` : file.displayName,
        path: index === 1 ? `/${'很长的存储路径/'.repeat(16)}B.hnn` : file.path,
      }))
    : files;
  return (
    <>
      {host.controls}
      <div
        data-testid="painting"
        style={{ height: split ? 400 : 650, width: '100%', position: 'relative' }}
      >
        <LayeredPaintingBoard
          controller={controller}
          toolbarInlinePickers={inline}
          files={legacy ? undefined : fixtureFiles}
          currentFileKey={host.current}
          paneId="primary"
          onSelectFile={host.onSelectFile}
          onRequestRemove={remove ? async () => ({ status: 'cancelled' }) : undefined}
          layout={legacy ? undefined : host.layout}
        />
      </div>
      {split ? (
        <div data-testid="secondary" style={{ height: 400, width: '100%', position: 'relative' }}>
          <LayeredPaintingBoard
            controller={secondary}
            toolbarInlinePickers={inline}
            layout={{ ...host.layout, edge: host.edge === 'top' ? 'bottom' : 'top' }}
          />
        </div>
      ) : null}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
