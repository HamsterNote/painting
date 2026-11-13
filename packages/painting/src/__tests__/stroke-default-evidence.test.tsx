import { render } from '@testing-library/react';
import { Toolbar } from '../layered/Toolbar';
import { makeLayeredController, commitLayeredStroke } from './fixtures/layered';

test('S1 explicitly green host and existing ink survive toolbar mount and remount', () => {
  const controller = makeLayeredController();
  commitLayeredStroke(controller, 'green');
  const before = controller.getSnapshot('document');
  const first = render(<Toolbar controller={controller} />);
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#008060');
  first.unmount();
  render(<Toolbar controller={controller} />);
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#008060');
  expect(controller.getSnapshot('document')).toBe(before);
  expect(before.objects[0]).toMatchObject({
    kind: 'freehand',
    brushSnapshot: { color: '#008060' },
  });
});
