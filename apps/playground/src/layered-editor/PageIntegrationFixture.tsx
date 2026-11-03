import { useEffect, useState } from 'react';
import {
  createEditor,
  migrateLegacyDocument,
  PageDrawingSurface,
  type LayeredEditorController,
} from '@hamster-note/painting';

declare global {
  interface Window {
    __pageEditors?: LayeredEditorController[];
  }
}

/** Runnable integration fixture: the host owns PDF-like page layout and navigation. */
export function PageIntegrationFixture({ readOnly = false }: { readOnly?: boolean }) {
  const [editors] = useState(() => {
    if (!readOnly) return [createEditor(), createEditor()];
    const result = migrateLegacyDocument({
      strokes: [
        {
          id: 'saved-pen',
          tool: 'pen',
          points: [
            { x: 30, y: 50 },
            { x: 70, y: 50 },
          ],
          strokeColor: '#d02080',
          strokeWidth: 8,
        },
        {
          id: 'saved-rect',
          tool: 'rect',
          points: [
            { x: 110, y: 30 },
            { x: 150, y: 70 },
          ],
          fillColor: '#008060',
        },
        {
          id: 'saved-text',
          tool: 'text',
          points: [
            { x: 180, y: 30 },
            { x: 300, y: 80 },
          ],
          text: 'Saved note',
          fontSize: 20,
        },
        {
          id: 'saved-image',
          tool: 'image',
          points: [
            { x: 330, y: 30 },
            { x: 370, y: 70 },
          ],
          src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>')}`,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.path);
    return [createEditor(result.value), createEditor(result.value)];
  });
  const [enabled, setEnabled] = useState(!readOnly);
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
        <button onClick={() => setEnabled((value) => !value)}>
          {enabled ? 'Disable input' : 'Enable input'}
        </button>
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
            enabled={enabled}
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
