'use dom';

import { useEffect, useState } from 'react';
import { createEditor, type LayeredEditorController } from '@hamster-note/painting/layered';
import { LayeredPaintingBoard } from '@hamster-note/painting-board';
import { mixedFixture } from './mixedFixture';

declare global {
  interface Window {
    __layeredEditor?: LayeredEditorController;
    __layeredRenders?: { display: number; objects: number };
  }
}

export default function LayeredEditorDom(_props: { dom?: import('expo/dom').DOMProps }) {
  const [params] = useState(
    () => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  );
  const [controller] = useState(() =>
    createEditor(params.get('fixture') === 'mixed' ? mixedFixture() : undefined)
  );
  const [renders] = useState(() => ({ display: 0, objects: 0 }));
  const diagnostics = params.get('diagnostics') === '1';
  useEffect(() => {
    if (!diagnostics) return;
    window.__layeredEditor = controller;
    window.__layeredRenders = renders;
    return () => {
      delete window.__layeredEditor;
      delete window.__layeredRenders;
    };
  }, [controller, diagnostics, renders]);
  return (
    <div
      style={{
        height: '100dvh',
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
      }}
    >
      <LayeredPaintingBoard
        controller={controller}
        historyReadyDelayMs={
          diagnostics ? Math.min(1000, Math.max(0, Number(params.get('handoffDelay')) || 0)) : 0
        }
        onRender={
          diagnostics
            ? (scope) => {
                if (scope === 'display') renders.display++;
                else renders.objects++;
              }
            : undefined
        }
      />
    </div>
  );
}
