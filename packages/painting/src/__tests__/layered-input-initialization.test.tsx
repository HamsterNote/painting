import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server.node';
import { createEditor } from '../layered/createEditor';
import { LayeredPaintingBoard } from '../layered/PaintingBoard';
import { INPUT_MODE_PREFERENCE_KEY as key } from '../layered/inputModePreference';
import { makeLayeredController } from './fixtures/layered';
import { LayeredDrawingSurface } from '../layered/DrawingSurface';

jest.mock('../layered/DrawingLayer', () => ({ DrawingLayer: () => null }));

beforeEach(() => localStorage.clear());

test.each([
  ['finger', 'pen', 'none', 'finger'],
  [undefined, 'finger', 'none', 'finger'],
  [undefined, undefined, 'draw', 'finger'],
  [undefined, undefined, 'none', 'pen'],
  [undefined, undefined, undefined, 'auto'],
] as const)('initialization priority: %s / %s / %s', (explicit, stored, touch, expected) => {
  if (stored) localStorage.setItem(key, JSON.stringify(stored));
  const editor = createEditor(undefined, { inputMode: explicit });
  const policy = touch ? ({ mouse: 'draw', pen: 'draw', touch } as const) : undefined;
  const { rerender } = render(<LayeredPaintingBoard controller={editor} inputPolicy={policy} />);
  expect(screen.getByRole('toolbar').getAttribute('data-input-mode')).toBe(expected);
  expect(screen.getByTestId('layered-surface').getAttribute('data-input-mode')).toBe(expected);
  expect(screen.getByTestId('layered-surface').getAttribute('data-input-ready')).toBe('true');
  act(() => {
    editor.setInputMode('auto');
  });
  rerender(
    <LayeredPaintingBoard
      controller={editor}
      inputPolicy={{ mouse: 'none', pen: 'none', touch: 'none' }}
    />
  );
  expect(editor.getSnapshot('input').mode).toBe('auto');
});

test('core host can initialize explicitly before mounting and SSR blocks interaction', () => {
  localStorage.setItem(key, '"pen"');
  const editor = makeLayeredController();
  editor.initializeInputMode('finger');
  const html = renderToString(<LayeredPaintingBoard controller={editor} />);
  expect(html).toContain('data-input-ready="false"');
  expect(html).toContain('pointer-events:none');
  expect(html).not.toContain('role="toolbar"');
  render(<LayeredPaintingBoard controller={editor} />);
  expect(screen.getByRole('toolbar').getAttribute('data-input-mode')).toBe('finger');
});

test('consumer layout styles cannot remove the non-editing selection boundary', () => {
  render(
    <LayeredDrawingSurface
      controller={createEditor()}
      style={{
        width: 640,
        background: 'red',
        userSelect: 'text',
        WebkitUserSelect: 'text',
        WebkitTouchCallout: 'default',
      }}
    />
  );
  const { style } = screen.getByTestId('layered-surface');
  expect(style.width).toBe('640px');
  expect(style.background).toBe('red');
  expect(style.userSelect).toBe('none');
  expect(style.WebkitUserSelect).toBe('none');
  expect(style.WebkitTouchCallout).toBe('none');
});
