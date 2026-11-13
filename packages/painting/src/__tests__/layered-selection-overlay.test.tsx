import { render, act } from '@testing-library/react';
import { SelectionOverlay } from '../layered/SelectionOverlay';
import { deriveLayeredSelectionGeometry } from '../core/layeredSelectionGeometry';
import { layeredRect, makeLayeredController } from './fixtures/layered';

test('overlay uses shared region, preserves handles and disappears for other tools', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('selection');
  controller.setSelection(['rect']);
  const { container } = render(<SelectionOverlay controller={controller} />);
  const { region } = deriveLayeredSelectionGeometry(controller)!;
  const move = container.querySelector('[data-selection-operation="move"]')!;
  expect(Number(move.getAttribute('x'))).toBe(region.minX);
  expect(Number(move.getAttribute('y'))).toBe(region.minY);
  expect(Number(move.getAttribute('width'))).toBe(region.maxX - region.minX);
  expect(Number(move.getAttribute('height'))).toBe(region.maxY - region.minY);
  expect(container.querySelectorAll('[data-selection-operation]')).toHaveLength(3);
  act(() => {
    controller.setTool('rect');
  });
  expect(container.querySelector('svg')).toBeNull();
});
