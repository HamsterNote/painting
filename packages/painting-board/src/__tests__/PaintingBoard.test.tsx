import { createEditor, PaintingBoard, LayeredPaintingBoard } from '@hamster-note/painting-board';
import { IDENTITY_TRANSFORM } from '@hamster-note/painting/layered';
import { act, render, screen } from '@testing-library/react';

beforeEach(() => {
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill',
    ].map((key) => [key, jest.fn()])
  );
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
});
afterEach(() => jest.restoreAllMocks());

test('public board is the layered board and fills its parent', () => {
  expect(PaintingBoard).toBe(LayeredPaintingBoard);
  const { container } = render(<PaintingBoard controller={createEditor()} />);
  expect(container.firstElementChild).toHaveProperty('style.width', '100%');
  expect(container.firstElementChild).toHaveProperty('style.height', '100%');
  expect(screen.getByTestId('layered-display')).toBeTruthy();
  expect(screen.getByTestId('layered-drawing')).toBeTruthy();
});

test.each([false, { enabled: false }, { minScale: 0.5, maxScale: 4 }] as const)(
  'board forwards virtual paper options %p to its one controller',
  (virtualPaper) => {
    const controller = createEditor();
    render(<PaintingBoard controller={controller} virtualPaper={virtualPaper} />);
    const options = controller.getSnapshot('navigation').virtualPaper;
    expect(options.enabled).toBe(virtualPaper !== false && !('enabled' in virtualPaper));
    expect(options.minScale).toBe(virtualPaper && 'minScale' in virtualPaper ? 0.5 : 0.25);
    expect(options.maxScale).toBe(virtualPaper && 'maxScale' in virtualPaper ? 4 : 8);
  }
);

test('controller owns initial document, selection and history instead of a second value/ref state', () => {
  const controller = createEditor({
    schemaVersion: 3,
    documentRevision: 0,
    objects: [
      {
        objectId: 'text',
        kind: 'text',
        objectRevision: 1,
        transform: IDENTITY_TRANSFORM,
        transformRevision: 1,
        content: '初始文档',
        localBounds: { minX: 10, minY: 10, maxX: 110, maxY: 50 },
        color: '#000000',
        fontSize: 20,
      },
    ],
  });
  render(<PaintingBoard controller={controller} toolbar={false} />);
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(screen.getByText('初始文档')).toBeTruthy();
  act(() => {
    controller.setSelection(['text']);
    controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['text'] });
  });
  expect(controller.getSnapshot('selection')).toEqual([]);
  expect(screen.queryByText('初始文档')).toBeNull();
  act(() => {
    controller.undo();
  });
  expect(screen.getByText('初始文档')).toBeTruthy();
});
