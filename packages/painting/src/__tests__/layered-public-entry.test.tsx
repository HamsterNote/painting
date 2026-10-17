import { render, screen } from '@testing-library/react';
import * as painting from '@hamster-note/painting';
import * as headless from '../core';
import { mockLayeredDom } from './fixtures/layeredDom';

afterEach(() => jest.restoreAllMocks());

test('public root mounts the controller based board and surface aliases', () => {
  mockLayeredDom();
  const controller = painting.createEditor();
  const board = render(<painting.PaintingBoard controller={controller} />);
  expect(screen.getByTestId('layered-surface')).toBeTruthy();
  expect(screen.getByRole('toolbar')).toBeTruthy();
  board.unmount();
  render(<painting.DrawingSurface controller={controller} />);
  expect(screen.getByTestId('layered-surface')).toBeTruthy();
  expect(painting.DrawingSurface).toBe(painting.LayeredDrawingSurface);
  expect(painting.PaintingBoard).toBe(painting.LayeredPaintingBoard);
});

test('public entries expose schema3 and no old controller, migrations or renderer fallback', () => {
  expect(headless.LAYERED_SCHEMA_VERSION).toBe(3);
  expect(headless.createLayeredEditorController).toBe(painting.createLayeredEditorController);
  for (const key of [
    'PaintingController',
    'StrokeRenderer',
    'useCanvas',
    'migrateStroke',
    'normalizeDrawingValue',
    'DRAWING_STROKE_SCHEMA_VERSION',
  ]) {
    expect(painting).not.toHaveProperty(key);
    expect(headless).not.toHaveProperty(key);
  }
  expect(painting.normalizeViewport({ scale: 0, tx: NaN, ty: Infinity })).toEqual({
    scale: 0.25,
    tx: 0,
    ty: 0,
  });
});
