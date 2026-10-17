import { act, fireEvent, render, screen } from '@testing-library/react';
import { VirtualPaper } from '../layered/NavigationOverlay';
import { makeLayeredController } from './fixtures/layered';

test('paper visibility is controller owned and presentation creates no navigation listeners', () => {
  const controller = makeLayeredController();
  const { container } = render(<VirtualPaper controller={controller} />);
  expect(container.childElementCount).toBe(0);
  act(() => {
    controller.setNavigation({ paper: true });
  });
  const paper = screen.getByTestId('layered-paper');
  const before = controller.getSnapshot('viewport');
  fireEvent.wheel(paper, { ctrlKey: true, deltaY: -100 });
  fireEvent.pointerDown(paper, { pointerId: 1, pointerType: 'touch' });
  fireEvent.pointerMove(paper, { pointerId: 1, clientX: 200 });
  expect(controller.getSnapshot('viewport')).toBe(before);
  expect(paper.style.pointerEvents).toBe('none');
  act(() => {
    controller.setNavigation({ paper: false });
  });
  expect(screen.queryByTestId('layered-paper')).toBeNull();
});

test('paper follows exactly one authoritative viewport and invalid updates cannot corrupt its matrix', () => {
  const controller = makeLayeredController();
  controller.setNavigation({ paper: true });
  render(<VirtualPaper controller={controller} />);
  act(() => {
    controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale: 1.5, tx: -12.5, ty: 40 },
    });
  });
  const group = screen.getByTestId('layered-paper').querySelector('g')!;
  expect(group.getAttribute('transform')).toBe('matrix(1.5 0 0 1.5 -12.5 40)');
  const before = controller.getSnapshot('viewport');
  const invalid = controller.updateViewport({
    type: 'replace',
    expectedRevision: before.revision,
    viewport: { scale: NaN, tx: Infinity, ty: 0 },
  });
  expect(invalid.ok).toBe(false);
  expect(controller.getSnapshot('viewport')).toBe(before);
  expect(group.getAttribute('transform')).toBe('matrix(1.5 0 0 1.5 -12.5 40)');
});
