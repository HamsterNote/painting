import { PresentationCoordinator } from '../../layered/PresentationCoordinator';
import { commitLayeredStroke, layeredRect, makeLayeredController } from '../fixtures/layered';

describe('ordered presentation ownership', () => {
  test('three pending strokes retain ordered ownership during a fourth stroke and stale ACKs', () => {
    const controller = makeLayeredController([layeredRect()]);
    const queue = new PresentationCoordinator(controller);
    for (const id of ['a', 'b', 'c']) commitLayeredStroke(controller, id);
    const tokens = ['a', 'b', 'c'].map((id) => queue.getIdentity(`object-${id}`)!);
    const visible = tokens.map(() => jest.fn());
    tokens.forEach((token, index) => queue.mount(token.objectId, { setVisible: visible[index] }));
    const batch = {
      sessionId: 'fourth',
      pointerId: 1,
      source: 'pen' as const,
      coordinateSpace: 'world' as const,
      viewportRevision: 0,
    };
    expect(
      controller.beginFreehand({
        type: 'begin',
        commitId: 'fourth',
        pressureCapability: 'available',
        batch: {
          ...batch,
          batchSequence: 0,
          samples: [{ sequence: 0, x: 20, y: 30, time: 0, phase: 'down' }],
        },
      }).ok
    ).toBe(true);
    const active = controller.getSnapshot('interaction').activeFreehand;
    expect(queue.acknowledge({ ...tokens[0], commitId: 'fourth' })).toBe(false);
    expect(queue.acknowledge(tokens[2])).toBe(true);
    expect(queue.acknowledge(tokens[2])).toBe(true);
    expect(queue.getPending()).toHaveLength(3);
    expect(queue.acknowledge(tokens[0])).toBe(true);
    expect(queue.getPending().map((object) => object.commitId)).toEqual(['b', 'c']);
    expect(visible[0]).toHaveBeenLastCalledWith(true);
    expect(visible[1]).toHaveBeenLastCalledWith(false);
    expect(visible[2]).toHaveBeenLastCalledWith(false);
    expect(queue.acknowledge(tokens[1])).toBe(true);
    expect(queue.getPending()).toEqual([]);
    expect(queue.acknowledge(tokens[0])).toBe(false);
    expect(controller.getSnapshot('interaction').activeFreehand).toEqual(active);
    expect(controller.getSnapshot('document').objects.map((object) => object.objectId)).toEqual([
      'rect',
      'object-a',
      'object-b',
      'object-c',
    ]);
    queue.destroy();
  });

  test('undo of the newest pending stroke rejects its late ACK and redo restores only that stroke', () => {
    const controller = makeLayeredController();
    const queue = new PresentationCoordinator(controller);
    for (const id of ['a', 'b', 'c']) commitLayeredStroke(controller, id);
    const staleC = queue.getIdentity('object-c')!;
    const visibility = jest.fn();
    queue.mount(staleC.objectId, { setVisible: visibility });
    expect(controller.undo().ok).toBe(true);
    expect(queue.getPending().map((object) => object.commitId)).toEqual(['a', 'b']);
    expect(visibility).toHaveBeenLastCalledWith(false);
    expect(queue.acknowledge(staleC)).toBe(false);
    expect(controller.redo().ok).toBe(true);
    const currentC = queue.getIdentity('object-c')!;
    expect(queue.acknowledge(staleC)).toBe(false);
    queue.mount(currentC.objectId, { setVisible: visibility });
    for (const id of ['b', 'a']) {
      const token = queue.getIdentity(`object-${id}`)!;
      queue.mount(token.objectId, { setVisible: jest.fn() });
      expect(queue.acknowledge(token)).toBe(true);
    }
    expect(queue.acknowledge(currentC)).toBe(true);
    expect(queue.getPending()).toEqual([]);
    expect(visibility).toHaveBeenLastCalledWith(true);
    expect(controller.getSnapshot('document').objects).toHaveLength(3);
    queue.destroy();
  });

  test('late ACK cannot overtake an older stroke; handoff repaints synchronously', () => {
    const controller = makeLayeredController();
    const queue = new PresentationCoordinator(controller);
    commitLayeredStroke(controller, 'a');
    const staleA = queue.getIdentity('object-a')!;
    commitLayeredStroke(controller, 'b');
    const a = queue.getIdentity('object-a')!;
    const b = queue.getIdentity('object-b')!;
    const visibleA = jest.fn();
    const visibleB = jest.fn();
    queue.mount(a.objectId, { setVisible: visibleA });
    queue.mount(b.objectId, { setVisible: visibleB });
    const repaint = jest.fn();
    queue.setRepaint(repaint);
    expect(queue.acknowledge(staleA)).toBe(false);
    expect(queue.acknowledge(b)).toBe(true);
    expect(queue.getPending()).toHaveLength(2);
    expect(visibleB).toHaveBeenLastCalledWith(false);
    expect(queue.acknowledge(a)).toBe(true);
    expect(queue.getPending()).toHaveLength(0);
    expect(visibleA).toHaveBeenLastCalledWith(true);
    expect(visibleB).toHaveBeenLastCalledWith(true);
    expect(repaint).toHaveBeenCalledTimes(2);
    expect(queue.acknowledge(a)).toBe(false);
    queue.destroy();
  });

  test('an appended shape stays behind the pending prefix; revisions renew tokens', () => {
    const controller = makeLayeredController();
    const queue = new PresentationCoordinator(controller);
    commitLayeredStroke(controller, 'a');
    const stale = queue.getIdentity('object-a')!;
    expect(
      controller.editObjects({ expectedDocumentRevision: 1, upsert: [layeredRect()] }).ok
    ).toBe(true);
    const shapeVisible = jest.fn();
    queue.mount('rect', { setVisible: shapeVisible });
    queue.mount('object-a', { setVisible: jest.fn() });
    expect(shapeVisible).toHaveBeenLastCalledWith(false);
    expect(queue.acknowledge(stale)).toBe(false);
    expect(queue.acknowledge(queue.getIdentity('object-a')!)).toBe(true);
    expect(shapeVisible).toHaveBeenLastCalledWith(true);
    queue.destroy();
  });

  test('undo removes pending ownership and stale ACK cannot clear the next active stroke', () => {
    const controller = makeLayeredController();
    const queue = new PresentationCoordinator(controller);
    commitLayeredStroke(controller, 'a');
    const stale = queue.getIdentity('object-a')!;
    const visibility = jest.fn();
    queue.mount(stale.objectId, { setVisible: visibility });
    controller.undo();
    expect(visibility).toHaveBeenLastCalledWith(false);
    expect(queue.getPending()).toHaveLength(0);
    controller.beginFreehand({
      type: 'begin',
      commitId: 'next',
      pressureCapability: 'available',
      batch: {
        sessionId: 'next',
        pointerId: 1,
        source: 'pen',
        coordinateSpace: 'world',
        viewportRevision: 0,
        batchSequence: 0,
        samples: [{ sequence: 0, x: 1, y: 2, phase: 'down', time: 0 }],
      },
    });
    expect(queue.acknowledge(stale)).toBe(false);
    expect(controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');
    queue.destroy();
  });

  test('ACK requires a mounted node and the exact geometry identity', () => {
    const controller = makeLayeredController();
    const queue = new PresentationCoordinator(controller);
    commitLayeredStroke(controller, 'a');
    const token = queue.getIdentity('object-a')!;
    expect(queue.acknowledge(token)).toBe(false);
    const unmount = queue.mount(token.objectId, { setVisible: jest.fn() });
    expect(queue.acknowledge({ ...token, geometryRevision: 'wrong' })).toBe(false);
    unmount();
    expect(queue.acknowledge(token)).toBe(false);
    queue.destroy();
  });
});
