/** @jest-environment node */

import { createGestureSession, reduceGestureSession } from '../../core';
import type {
  CreateGestureSessionOptions,
  InputDevice,
  InputPhase,
  NormalizedPointerInput,
  SelectionGestureDescriptor,
  TargetRole,
  GestureSessionTransition,
} from '../../core';

const EMPTY_DOCUMENT = { schemaVersion: 2 as const, strokes: [] };

function input(
  pointerId: string | number,
  phase: InputPhase,
  targetRole: TargetRole,
  x = 0,
  y = 0,
  device: InputDevice = 'touch',
  alt = false
): NormalizedPointerInput {
  return {
    pointerId,
    phase,
    targetRole,
    device,
    screen: { x, y },
    timestamp: 100,
    modifiers: { alt, ctrl: false, meta: false, shift: false },
  };
}

function reduce(
  options: CreateGestureSessionOptions,
  ...inputs: readonly NormalizedPointerInput[]
): GestureSessionTransition {
  return inputs.reduce<GestureSessionTransition>((transition, sample) => reduceGestureSession(transition.session, sample), {
    session: createGestureSession(options),
    effects: Object.freeze([]),
  });
}

function selection(kind: SelectionGestureDescriptor['kind']): SelectionGestureDescriptor {
  const box = { center: { x: 10, y: 10 }, width: 20, height: 10, rotationRad: 0 };
  if (kind === 'move') {
    return { kind, box };
  }
  if (kind === 'resize') {
    return { kind, box, anchor: { x: 0, y: 5 }, axis: { x: 1, y: 1 }, minimumSize: 2 };
  }
  if (kind === 'uniform-scale') {
    return {
      kind,
      box,
      anchor: { x: 0, y: 5 },
      handle: { x: 20, y: 15 },
      minimumScreenExtent: 4,
    };
  }
  return { kind, box, pivot: { x: 10, y: 10 } };
}

describe('core/gesture/session', () => {
  it('由 pending-single 进入笔迹预览，只在 up 产生一次提交，并在 cancel 丢弃预览', () => {
    const options: CreateGestureSessionOptions = {
      document: EMPTY_DOCUMENT,
      createPenStroke: ({ points }) => ({
        schemaVersion: 2,
        id: 'stable-pen',
        tool: 'pen',
        points: [...points],
      }),
    };
    const pending = reduce(options, input('pen', 'down', 'paper', 1, 2, 'pen'));
    const drawing = reduceGestureSession(
      pending.session,
      input('pen', 'move', 'ruler', 4, 6, 'pen')
    );
    const committed = reduceGestureSession(
      drawing.session,
      input('pen', 'up', 'none', 7, 8, 'pen')
    );
    const cancelled = reduce(
      options,
      input('cancelled', 'down', 'paper', 1, 2, 'pen'),
      input('cancelled', 'move', 'paper', 4, 6, 'pen'),
      input('cancelled', 'cancel', 'paper', 4, 6, 'pen')
    );

    expect(pending.session.transient.paper).toMatchObject({ kind: 'pending-single' });
    expect(Object.isFrozen(pending.session)).toBe(true);
    expect(Object.isFrozen(pending.session.transient)).toBe(true);
    expect(drawing.session.transient.paper).toMatchObject({
      kind: 'drawing',
      points: [
        { x: 1, y: 2 },
        { x: 4, y: 6 },
      ],
    });
    expect(drawing.effects).toEqual([]);
    expect(drawing.session.document).toBe(pending.session.document);
    expect(committed.effects).toEqual([
      { type: 'document-commit', document: committed.session.document },
    ]);
    expect(committed.session.document.strokes).toEqual([
      expect.objectContaining({
        id: 'stable-pen',
        tool: 'pen',
        points: [
          { x: 1, y: 2 },
          { x: 4, y: 6 },
          { x: 7, y: 8 },
        ],
      }),
    ]);
    expect(cancelled.effects).toEqual([]);
    expect(cancelled.session.document.strokes).toEqual([]);
    expect(cancelled.session.transient.paper).toBeUndefined();
    expect(cancelled.session.ownership.active).toEqual([]);
    expect(cancelled.session.status).toBe('cancelled');
  });

  it('已开始的笔迹不会被后来的同纸面 pointer 接管或取消', () => {
    const drawing = reduce(
      { document: EMPTY_DOCUMENT },
      input('first', 'down', 'paper', 0, 0, 'pen'),
      input('first', 'move', 'paper', 5, 0, 'pen')
    );
    const laterPointer = reduceGestureSession(
      drawing.session,
      input('second', 'down', 'paper', 10, 0)
    );
    const committed = reduceGestureSession(
      laterPointer.session,
      input('first', 'up', 'paper', 5, 0, 'pen')
    );

    expect(laterPointer.session.transient.paper).toMatchObject({
      kind: 'drawing',
      pointerId: 'first',
    });
    expect(committed.effects).toHaveLength(1);
    expect(committed.session.document.strokes).toHaveLength(1);
  });

  it('两纸面 touch 进入固定 navigation pair，第三触点与单独结束不会破坏 pair', () => {
    const two = reduce(
      { document: EMPTY_DOCUMENT },
      input('one', 'down', 'paper', 0, 0),
      input('two', 'down', 'paper', 10, 0),
      input('two', 'move', 'paper', 20, 10)
    );
    const third = reduceGestureSession(two.session, input('three', 'down', 'paper', 99, 99));
    const thirdUp = reduceGestureSession(third.session, input('three', 'up', 'paper', 99, 99));
    const cancelled = reduceGestureSession(thirdUp.session, input('one', 'cancel', 'paper', 0, 0));

    expect(two.session.transient).toMatchObject({
      paper: { kind: 'navigating-two', pointerIds: ['one', 'two'] },
      navigation: {
        startMidpoint: { x: 5, y: 0 },
        currentMidpoint: { x: 10, y: 5 },
        midpointDelta: { x: 5, y: 5 },
        scaleRatio: Math.sqrt(5),
        intent: {
          startFocal: { x: 5, y: 0 },
          currentFocal: { x: 10, y: 5 },
          scaleRatio: Math.sqrt(5),
        },
      },
    });
    expect(two.effects).toEqual([]);
    expect(thirdUp.session.transient.paper).toMatchObject({
      kind: 'navigating-two',
      pointerIds: ['one', 'two'],
    });
    expect(cancelled.session.transient.paper).toBeUndefined();
    expect(cancelled.session.status).toBe('cancelled');
  });

  it('不同 owner 可以并发：paper 绘制不妨碍 ruler 双指刚体预览', () => {
    const session = reduce(
      { document: EMPTY_DOCUMENT, ruler: { state: { center: { x: 10, y: 10 }, rotationRad: 0 } } },
      input('pen', 'down', 'paper', 0, 0, 'pen'),
      input('pen', 'move', 'paper', 3, 0, 'pen'),
      input('ruler-one', 'down', 'ruler', 0, 0),
      input('ruler-two', 'down', 'ruler', 10, 0),
      input('ruler-two', 'move', 'ruler', 10, 10)
    );

    expect(session.session.transient.paper).toMatchObject({ kind: 'drawing' });
    expect(session.session.transient.ruler).toMatchObject({
      pointerIds: ['ruler-one', 'ruler-two'],
      state: { center: { x: 10, y: 15 }, rotationRad: Math.PI / 4 },
    });
    expect(
      (session.session.transient.ruler?.state as Record<string, unknown>).scale
    ).toBeUndefined();
  });

  it('尺子 mouse 保持抓取偏移，Alt 绕 caller pivot 旋转并按 45 度吸附', () => {
    const translation = reduce(
      { document: EMPTY_DOCUMENT, ruler: { state: { center: { x: 10, y: 10 }, rotationRad: 0 } } },
      input('mouse', 'down', 'ruler', 7, 8, 'mouse'),
      input('mouse', 'move', 'ruler', 17, 18, 'mouse')
    );
    const rotation = reduce(
      {
        document: EMPTY_DOCUMENT,
        ruler: { state: { center: { x: 20, y: 10 }, rotationRad: 0 }, pivot: { x: 10, y: 10 } },
      },
      input('alt-mouse', 'down', 'ruler', 20, 10, 'mouse', true),
      input('alt-mouse', 'move', 'ruler', 10, 20, 'mouse', true)
    );

    expect(translation.session.transient.ruler?.state).toEqual({
      center: { x: 20, y: 20 },
      rotationRad: 0,
    });
    expect(rotation.session.transient.ruler?.state).toEqual({
      center: { x: 10, y: 20 },
      rotationRad: Math.PI / 2,
    });
  });

  it('尺子双 touch 等待 pair，只进行中点平移与旋转；第三 touch 或无关 mouse 结束不影响它', () => {
    const paired = reduce(
      { document: EMPTY_DOCUMENT, ruler: { state: { center: { x: 5, y: 5 }, rotationRad: 0 } } },
      input('first', 'down', 'ruler', 0, 0),
      input('second', 'down', 'ruler', 10, 0),
      input('second', 'move', 'ruler', 10, 10)
    );
    const third = reduceGestureSession(paired.session, input('third', 'down', 'ruler', 40, 40));
    const unrelatedDown = reduceGestureSession(
      third.session,
      input('mouse', 'down', 'paper', 0, 0, 'mouse')
    );
    const unrelated = reduceGestureSession(
      unrelatedDown.session,
      input('mouse', 'up', 'paper', 0, 0, 'mouse')
    );
    const stopped = reduceGestureSession(unrelated.session, input('first', 'up', 'ruler', 0, 0));

    expect(paired.session.transient.ruler).toBeDefined();
    expect(paired.session.transient.ruler).toMatchObject({
      pointerIds: ['first', 'second'],
      state: { center: { x: 5, y: 10 }, rotationRad: Math.PI / 4 },
    });
    expect(third.session.transient.ruler?.pointerIds).toEqual(['first', 'second']);
    expect(unrelated.session.transient.ruler?.pointerIds).toEqual(['first', 'second']);
    expect(stopped.session.transient.ruler).toBeUndefined();
  });

  it('按纯 interaction policy 区分单指 pan、none、mouse/pen pan 与显式绘制阈值', () => {
    const pan = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { singleTouch: 'pan' } },
      input('touch', 'down', 'paper', 0, 0),
      input('touch', 'move', 'paper', 4, 5)
    );
    const none = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { singleTouch: 'none' } },
      input('touch', 'down', 'paper', 0, 0),
      input('touch', 'move', 'paper', 20, 0)
    );
    const mouse = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { mouseDragPan: true } },
      input('mouse', 'down', 'paper', 0, 0, 'mouse'),
      input('mouse', 'move', 'paper', 4, 5, 'mouse')
    );
    const pen = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { penPan: true } },
      input('pen', 'down', 'paper', 0, 0, 'pen'),
      input('pen', 'move', 'paper', 4, 5, 'pen')
    );
    const mouseFallback = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { singleTouch: 'pan', mouseDragPan: false } },
      input('mouse-draw', 'down', 'paper', 0, 0, 'mouse'),
      input('mouse-draw', 'move', 'paper', 4, 5, 'mouse')
    );
    const penFallback = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { singleTouch: 'pan', penPan: false } },
      input('pen-draw', 'down', 'paper', 0, 0, 'pen'),
      input('pen-draw', 'move', 'paper', 4, 5, 'pen')
    );
    const threshold = reduce(
      {
        document: EMPTY_DOCUMENT,
        interactionPolicy: { drawCommitThreshold: 10 },
      },
      input('draw', 'down', 'paper', 0, 0, 'pen'),
      input('draw', 'move', 'paper', 9, 0, 'pen')
    );
    const thresholdReached = reduceGestureSession(
      threshold.session,
      input('draw', 'move', 'paper', 10, 0, 'pen')
    );

    expect(pan.session.transient).toMatchObject({
      paper: { kind: 'navigating-single' },
      navigation: { midpointDelta: { x: 4, y: 5 }, scaleRatio: 1 },
    });
    expect(none.session.transient.paper).toMatchObject({ kind: 'pending-single' });
    expect(mouse.session.transient.paper).toMatchObject({ kind: 'navigating-single' });
    expect(pen.session.transient.paper).toMatchObject({ kind: 'navigating-single' });
    expect(mouseFallback.session.transient.paper).toMatchObject({ kind: 'drawing' });
    expect(penFallback.session.transient.paper).toMatchObject({ kind: 'drawing' });
    expect(threshold.session.transient.paper).toMatchObject({ kind: 'pending-single' });
    expect(thresholdReached.session.transient.paper).toMatchObject({ kind: 'drawing' });
  });

  it('twoTouch policy 分别支持 none、pan、zoom 与默认 pan-zoom，且第三 touch 不改变固定 navigation pair', () => {
    const none = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { twoTouch: 'none' } },
      input('one', 'down', 'paper', 0, 0),
      input('two', 'down', 'paper', 10, 0),
      input('two', 'move', 'paper', 20, 0)
    );
    const pan = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { twoTouch: 'pan' } },
      input('one', 'down', 'paper', 0, 0),
      input('two', 'down', 'paper', 10, 0),
      input('two', 'move', 'paper', 20, 0)
    );
    const panZoom = reduce(
      { document: EMPTY_DOCUMENT },
      input('one', 'down', 'paper', 0, 0),
      input('two', 'down', 'paper', 10, 0),
      input('two', 'move', 'paper', 20, 0),
      input('third', 'down', 'paper', 50, 50)
    );
    const zoom = reduce(
      { document: EMPTY_DOCUMENT, interactionPolicy: { twoTouch: 'zoom' } },
      input('one', 'down', 'paper', 0, 0),
      input('two', 'down', 'paper', 10, 0),
      input('two', 'move', 'paper', 30, 10)
    );

    expect(none.session.transient.paper).toMatchObject({
      kind: 'pending-single',
      pointerId: 'one',
    });
    expect(none.session.transient.navigation).toBeUndefined();
    expect(pan.session.transient.navigation).toMatchObject({ scaleRatio: 1 });
    expect(pan.session.transient.navigation?.intent).toMatchObject({
      startFocal: { x: 5, y: 0 },
      currentFocal: { x: 10, y: 0 },
      scaleRatio: 1,
    });
    expect(zoom.session.transient.navigation).toMatchObject({
      startMidpoint: { x: 5, y: 0 },
      currentMidpoint: { x: 15, y: 5 },
      scaleRatio: Math.sqrt(10),
      intent: {
        startFocal: { x: 5, y: 0 },
        currentFocal: { x: 5, y: 0 },
        scaleRatio: Math.sqrt(10),
      },
    });
    expect(panZoom.session.transient.navigation).toMatchObject({
      pointerIds: ['one', 'two'],
      scaleRatio: 2,
    });
  });

  it('ruler 与 selection 在 up 前合并最后合法样本；cancel 不产生完成 effect', () => {
    const ruler = reduce(
      { document: EMPTY_DOCUMENT, ruler: { state: { center: { x: 10, y: 10 }, rotationRad: 0 } } },
      input('ruler', 'down', 'ruler', 8, 8, 'mouse'),
      input('ruler', 'up', 'ruler', 18, 18, 'mouse')
    );
    const selectionActive = reduce(
      { document: EMPTY_DOCUMENT, selection: selection('move') },
      input('selection', 'down', 'selection', 10, 10)
    );
    const selectionUp = reduceGestureSession(
      selectionActive.session,
      input('selection', 'up', 'selection', 15, 7)
    );
    const rulerCancelled = reduce(
      { document: EMPTY_DOCUMENT, ruler: { state: { center: { x: 10, y: 10 }, rotationRad: 0 } } },
      input('cancel', 'down', 'ruler', 8, 8, 'mouse'),
      input('cancel', 'cancel', 'ruler', 18, 18, 'mouse')
    );

    expect(ruler.effects).toEqual([
      { type: 'ruler-complete', state: { center: { x: 20, y: 20 }, rotationRad: 0 } },
    ]);
    expect(selectionUp.effects).toEqual([
      { type: 'selection-commit', intent: { kind: 'move', delta: { x: 5, y: -3 } } },
    ]);
    expect(rulerCancelled.effects).toEqual([]);
  });

  it.each([
    [
      'move',
      input('selection', 'move', 'selection', 15, 7),
      { kind: 'move', delta: { x: 5, y: -3 } },
    ],
    [
      'resize',
      input('selection', 'move', 'selection', -10, -10),
      { kind: 'resize', anchor: { x: 0, y: 5 }, axis: { x: 1, y: 1 }, scale: { x: 0.1, y: 0.2 } },
    ],
    [
      'rotate',
      input('selection', 'move', 'selection', 10, 20),
      { kind: 'rotate', pivot: { x: 10, y: 10 }, deltaRad: Math.PI / 2 },
    ],
  ] as const)(
    '选区 %s 输出可重放语义 intent，并仅在完成时发 selection-commit',
    (kind, move, expected) => {
      const active = reduce(
        { document: EMPTY_DOCUMENT, selection: selection(kind) },
        input(
          'selection',
          'down',
          'selection',
          kind === 'rotate' ? 20 : 10,
          kind === 'rotate' ? 10 : 10
        ),
        move
      );
      const completed = reduceGestureSession(
        active.session,
        input('selection', 'up', 'selection', move.screen.x, move.screen.y)
      );

      expect(active.session.transient.selection).toEqual(expected);
      expect(active.effects).toEqual([]);
      expect(completed.effects).toEqual([{ type: 'selection-commit', intent: expected }]);
      expect(completed.session.document.strokes).toEqual([]);
    }
  );

  it('选区 cancel 清除预览且不提交；未知、重复生命周期与不支持工具都安全无误提交', () => {
    const active = reduce(
      { document: EMPTY_DOCUMENT, selection: selection('move') },
      input('selection', 'down', 'selection', 10, 10),
      input('selection', 'move', 'selection', 11, 10)
    );
    const cancelled = reduceGestureSession(
      active.session,
      input('selection', 'cancel', 'selection', 11, 10)
    );
    const unknown = reduceGestureSession(createGestureSession({ document: EMPTY_DOCUMENT }), {
      phase: 'unknown',
    });
    const duplicate = reduce(
      { document: EMPTY_DOCUMENT, tool: 'line' },
      input('one', 'down', 'paper', 0, 0),
      input('one', 'down', 'ruler', 2, 2),
      input('one', 'move', 'paper', 3, 3),
      input('one', 'up', 'paper', 3, 3)
    );

    expect(cancelled.effects).toEqual([]);
    expect(cancelled.session.transient.selection).toBeUndefined();
    expect(cancelled.session.status).toBe('cancelled');
    expect(unknown.effects).toEqual([]);
    expect(unknown.session.document.strokes).toEqual([]);
    expect(duplicate.effects).toEqual([]);
    expect(duplicate.session.status).toBe('failed');
  });

  it('uniform-scale 用 grab offset、投影 scalar 与最小屏幕尺寸，穿过 anchor 不反射', () => {
    const descriptor = selection('uniform-scale');
    const down = reduce(
      { document: EMPTY_DOCUMENT, selection: descriptor },
      // 落在放大命中区内而非视觉手柄中心，故 grabOffset 为 (2, -1)。
      input('scale', 'down', 'selection', 22, 14, 'mouse')
    );
    const atDown = down.session.transient.uniformScaleSelection;
    const doubled = reduceGestureSession(
      down.session,
      input('scale', 'move', 'selection', 42, 24, 'mouse')
    );
    const minimum = reduceGestureSession(
      down.session,
      input('scale', 'move', 'selection', 4, 7, 'mouse')
    );
    const reflected = reduceGestureSession(
      down.session,
      input('scale', 'move', 'selection', -20, -5, 'mouse')
    );
    const completed = reduceGestureSession(
      doubled.session,
      input('scale', 'up', 'selection', 42, 24, 'mouse')
    );

    expect(atDown).toEqual({ kind: 'uniform-scale', anchor: { x: 0, y: 5 }, scale: 1 });
    expect(doubled.session.transient.uniformScaleSelection).toEqual({
      kind: 'uniform-scale', anchor: { x: 0, y: 5 }, scale: 2,
    });
    // min(width, height)=10，minimum extent=4，故 scalar 下限为 0.4。
    expect(minimum.session.transient.uniformScaleSelection).toEqual({
      kind: 'uniform-scale', anchor: { x: 0, y: 5 }, scale: 0.4,
    });
    expect(reflected.session.transient.uniformScaleSelection).toEqual({
      kind: 'uniform-scale', anchor: { x: 0, y: 5 }, scale: 1,
    });
    expect(completed.effects).toEqual([
      { type: 'uniform-scale-commit', intent: doubled.session.transient.uniformScaleSelection },
    ]);
  });

  it('拒绝非角手柄、非有限值的 uniform-scale descriptor，不产生 selection commit', () => {
    const invalidCorner = createGestureSession({
      document: EMPTY_DOCUMENT,
      selection: {
        kind: 'uniform-scale',
        box: { center: { x: 10, y: 10 }, width: 20, height: 10, rotationRad: 0 },
        anchor: { x: 0, y: 5 },
        handle: { x: 10, y: 10 },
      },
    });
    const invalidValue = createGestureSession({
      document: EMPTY_DOCUMENT,
      selection: {
        kind: 'uniform-scale',
        box: { center: { x: 10, y: 10 }, width: 20, height: 10, rotationRad: 0 },
        anchor: { x: 0, y: 5 },
        handle: { x: 20, y: 15 },
        minimumScreenExtent: Number.NaN,
      },
    });

    for (const session of [invalidCorner, invalidValue]) {
      const down = reduceGestureSession(session, input('invalid', 'down', 'selection', 20, 15, 'mouse'));
      const up = reduceGestureSession(down.session, input('invalid', 'up', 'selection', 40, 25, 'mouse'));
      expect(up.effects).toEqual([]);
      expect(up.session.transient.uniformScaleSelection).toBeUndefined();
    }
  });
});
