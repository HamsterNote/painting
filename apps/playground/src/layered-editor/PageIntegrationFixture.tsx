import { useEffect, useState } from 'react';
import {
  createEditor,
  PageDrawingSurface,
  type LayeredEditorController,
} from '@hamster-note/painting';

declare global {
  interface Window {
    __pageEditors?: LayeredEditorController[];
  }
}

/** Runnable integration fixture: the host owns PDF-like page layout and navigation. */
export function PageIntegrationFixture() {
  const [editors] = useState(() => [createEditor(), createEditor()]);
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotated, setRotated] = useState(false);
  useEffect(() => {
    window.__pageEditors = editors;
    for (const editor of editors)
      editor.setFreehandSettings({
        color: '#d02080',
        nominalSize: 8,
        opacity: 1,
        pressureMode: 'constant',
        presetRevision: 1,
      });
    return () => {
      delete window.__pageEditors;
    };
  }, [editors]);
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#ddd' }}>
      <div>
        <button onClick={() => setScale((scale) => (scale === 1 ? 2.5 : 1))}>Zoom page</button>
        <button onClick={() => setRotated((value) => !value)}>Rotate page</button>
        <button onClick={() => setPage((page) => 1 - page)}>Switch page</button>
      </div>
      <div data-testid="page-scroll" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ height: 120 }} />
        <div
          data-testid="pdf-page"
          style={{
            position: 'relative',
            marginLeft: 70,
            width: (rotated ? 800 : 600) * scale,
            height: (rotated ? 600 : 800) * scale,
            background: 'white',
          }}
        >
          <div style={{ position: 'absolute', left: '20%', top: '30%', color: '#333' }}>
            PDF content remains visible under ink
          </div>
          <PageDrawingSurface
            pageId={`page-${page}`}
            controller={editors[page]!}
            geometry={{
              width: 600,
              height: 800,
              pageToSurface: rotated
                ? { a: 0, b: scale, c: -scale, d: 0, tx: 800 * scale, ty: 0 }
                : { a: scale, b: 0, c: 0, d: scale, tx: 0, ty: 0 },
            }}
          />
        </div>
        <div style={{ height: 400 }} />
      </div>
    </div>
  );
}
