import { act, fireEvent, render, screen } from '@testing-library/react';
import { NavigationOverlay, VirtualPaper } from '../layered/NavigationOverlay';
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

test.each([
  [1280, 1],
  [1280, 1.75],
  [390, 0.75],
])(
  'paper initially centers at width %s / zoom %s without changing y or later navigation',
  (width, scale) => {
    const bounds = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width,
      height: 849,
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: 849,
      toJSON: () => ({}),
    });

    try {
      const controller = makeLayeredController();
      controller.updateViewport({
        type: 'replace',
        expectedRevision: 0,
        viewport: { scale, tx: 13, ty: 47 },
      });
      controller.setNavigation({ paper: true, minimap: true });
      render(
        <>
          <VirtualPaper controller={controller} />
          <NavigationOverlay controller={controller} />
        </>
      );
      const paperWidth = Number(
        screen.getByTestId('layered-paper').querySelector('rect')!.getAttribute('width')
      );
      const tx = (width - paperWidth * scale) / 2;
      expect(controller.getSnapshot('viewport').viewport).toEqual({ scale, tx, ty: 47 });
      expect(
        screen.getByTestId('layered-paper').querySelector('g')!.getAttribute('transform')
      ).toBe(`matrix(${scale} 0 0 ${scale} ${tx} 47)`);
      expect(Number(screen.getByTestId('minimap-viewport').getAttribute('x'))).toBeCloseTo(
        -tx / scale
      );
      act(() => {
        controller.updateViewport({
          type: 'replace',
          expectedRevision: controller.getSnapshot('viewport').revision,
          viewport: { scale, tx: tx + 60, ty: -20 },
        });
        controller.setNavigation({ paper: false });
      });
      act(() => {
        controller.setNavigation({ paper: true });
      });
      expect(controller.getSnapshot('viewport').viewport).toEqual({ scale, tx: tx + 60, ty: -20 });
    } finally {
      bounds.mockRestore();
    }
  }
);

test.each(['top-left', 'center'] as const)(
  'explicit %s placement remains available',
  (initialPlacement) => {
    const bounds = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1280,
      height: 849,
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 849,
      toJSON: () => ({}),
    });
    try {
      const controller = makeLayeredController();
      controller.setNavigation({
        paper: true,
        virtualPaper: {
          ...controller.getSnapshot('navigation').virtualPaper,
          initialPlacement,
        },
      });
      render(<NavigationOverlay controller={controller} />);
      const expected =
        initialPlacement === 'top-left'
          ? { scale: 1, tx: 0, ty: 0 }
          : {
              scale: 1,
              tx: (1280 - 794) / 2,
              ty: (849 - 1123) / 2,
            };
      expect(controller.getSnapshot('viewport').viewport).toEqual(expected);
    } finally {
      bounds.mockRestore();
    }
  }
);
