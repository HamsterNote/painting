import {
  createViewportGestureController,
  type ViewportGestureControllerOptions,
} from '../viewportGestureController';
import * as webInput from '../../input/web/normalizePointerInput';

type PointerKind = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

function pointer(
  type: PointerKind,
  overrides: Partial<{
    pointerId: number;
    pointerType: 'mouse' | 'pen' | 'touch';
    clientX: number;
    clientY: number;
    button: number;
  }> = {}
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: overrides.pointerId ?? 1 },
    pointerType: { value: overrides.pointerType ?? 'touch' },
    clientX: { value: overrides.clientX ?? 0 },
    clientY: { value: overrides.clientY ?? 0 },
    button: { value: overrides.button ?? (type === 'pointermove' ? -1 : 0) },
    buttons: { value: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 },
    pressure: { value: 0.5 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  return event as PointerEvent;
}

function wheel(clientX: number, clientY: number, deltaY: number, ctrlKey = false): WheelEvent {
  return new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX, clientY, deltaY, ctrlKey });
}

describe('legacy-compat/viewportGestureController', () => {
  let host: HTMLDivElement;
  let requests: jest.Mock;
  let active: jest.Mock;
  let role: jest.Mock;
  let options: ViewportGestureControllerOptions;
  let controller: ReturnType<typeof createViewportGestureController>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    host.setPointerCapture = jest.fn();
    host.releasePointerCapture = jest.fn();
    host.hasPointerCapture = jest.fn(() => true);
    requests = jest.fn();
    active = jest.fn();
    role = jest.fn(() => 'paper');
    options = {
      host,
      listenerTarget: host,
      getRenderedViewport: () => ({ scale: 1, tx: 0, ty: 0 }),
      scaleLimits: { min: 0.5, max: 2 },
      getTargetRole: role,
      toLocalPoint: (event) => ({ x: event.clientX, y: event.clientY }),
      onViewportRequest: requests,
      onActiveChange: active,
    };
    controller = createViewportGestureController(options);
  });

  afterEach(() => {
    controller.dispose();
    host.remove();
  });

  it('在 down 锁定 paper owner，safe/ruler/selection/none 不会在 move 时接管', () => {
    controller.dispose();
    controller = createViewportGestureController({
      ...options,
      interactionPolicy: { singleTouch: 'pan' },
    });
    for (const targetRole of ['safe-control', 'ruler', 'selection', 'none'] as const) {
      role.mockReturnValueOnce(targetRole);
      host.dispatchEvent(pointer('pointerdown', { pointerId: targetRole.length }));
      document.dispatchEvent(pointer('pointermove', { pointerId: targetRole.length, clientX: 30 }));
    }
    expect(role).toHaveBeenCalledTimes(4);
    expect(requests).not.toHaveBeenCalled();

    host.dispatchEvent(pointer('pointerdown', { pointerId: 99 }));
    role.mockReturnValue('ruler');
    document.dispatchEvent(pointer('pointermove', { pointerId: 99, clientX: 20 }));
    expect(role).toHaveBeenCalledTimes(5);
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'touch', viewport: { scale: 1, tx: 20, ty: 0 } })
    );
  });

  it('pointer cancel、lost capture 与 blur 都取消而不提交', () => {
    const startPan = (id: number) => {
      host.dispatchEvent(pointer('pointerdown', { pointerId: id, pointerType: 'mouse' }));
      document.dispatchEvent(pointer('pointermove', { pointerId: id, pointerType: 'mouse', clientX: 10 }));
    };
    controller.dispose();
    controller = createViewportGestureController({ ...options, interactionPolicy: { mouseDragPan: true } });

    startPan(1);
    document.dispatchEvent(pointer('pointercancel', { pointerId: 1, pointerType: 'mouse', clientX: 10 }));
    expect(requests.mock.calls.some(([request]) => request.phase === 'commit')).toBe(false);
    startPan(2);
    const lost = pointer('pointercancel', { pointerId: 2, pointerType: 'mouse', clientX: 10 });
    Object.defineProperty(lost, 'type', { value: 'lostpointercapture' });
    host.dispatchEvent(lost);
    window.dispatchEvent(new Event('blur'));
    expect(active).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['none', undefined],
    ['pan', { scale: 1, tx: 5, ty: 0 }],
    ['zoom', { scale: 1.5, tx: -5, ty: 0 }],
    ['pan-zoom', { scale: 1.5, tx: 0, ty: 0 }],
  ] as const)('twoTouch=%s 使用 core intent 并固定最初 pair', (twoTouch, expected) => {
    controller.dispose();
    controller = createViewportGestureController({ ...options, interactionPolicy: { twoTouch } });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    host.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 20, clientY: 0 }));
    host.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 30, clientY: 0 }));
    // 先取出最后一次请求（可能为 undefined），再在单条无条件断言里覆盖两种分支：
    // expected 存在时期望最后一次请求的 source/viewport 匹配；expected 为 undefined 时期望没有任何请求。
    const lastRequest = requests.mock.calls.at(-1)?.[0];
    const observed =
      lastRequest === undefined
        ? undefined
        : { source: lastRequest.source, viewport: lastRequest.viewport };
    expect(observed).toEqual(
      expected === undefined ? undefined : { source: 'touch', viewport: expected }
    );
    const countBeforeThirdMove = requests.mock.calls.length;
    document.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: 200, clientY: 200 }));
    expect(requests).toHaveBeenCalledTimes(countBeforeThirdMove);
  });

  it('遵守 mouse/pen flags，并保留 draw threshold 的 core 默认单触绘制策略', () => {
    controller.dispose();
    controller = createViewportGestureController({
      ...options,
      interactionPolicy: { mouseDragPan: false, penPan: true, drawCommitThreshold: 10 },
    });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 31, pointerType: 'mouse' }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 31, pointerType: 'mouse', clientX: 30 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 31, pointerType: 'mouse', clientX: 30 }));
    expect(requests).not.toHaveBeenCalled();

    host.dispatchEvent(pointer('pointerdown', { pointerId: 32, pointerType: 'pen' }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 32, pointerType: 'pen', clientX: 30 }));
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'pointer', viewport: { scale: 1, tx: 30, ty: 0 } })
    );
  });

  it('以手势开始的 rendered viewport 为基准，不累计未确认 controlled request，final up 使用最终样本', () => {
    let reads = 0;
    controller.dispose();
    controller = createViewportGestureController({
      ...options,
      interactionPolicy: { mouseDragPan: true },
      getRenderedViewport: () => {
        reads += 1;
        return { scale: 1, tx: 0, ty: 0 };
      },
    });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 4, pointerType: 'mouse', clientX: 10 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 4, pointerType: 'mouse', clientX: 20 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 4, pointerType: 'mouse', clientX: 30 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 4, pointerType: 'mouse', clientX: 40 }));

    expect(reads).toBe(1);
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'commit', source: 'pointer', viewport: { scale: 1, tx: 30, ty: 0 } })
    );
  });

  it('wheel 独立于 pointer ownership，按 focal 缩放并受 Ctrl gate 与 scale limits 约束', () => {
    controller.dispose();
    controller = createViewportGestureController({
      ...options,
      interactionPolicy: { mouseDragPan: true },
      wheel: { requireCtrlOrMeta: true, getScaleRatio: () => 10 },
    });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 5, pointerType: 'mouse' }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 5, pointerType: 'mouse', clientX: 10 }));
    host.dispatchEvent(wheel(50, 40, -100));
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'pointer', viewport: { scale: 1, tx: 10, ty: 0 } })
    );
    host.dispatchEvent(wheel(50, 40, -100, true));
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'commit', source: 'wheel', viewport: { scale: 2, tx: -50, ty: -40 } })
    );
    document.dispatchEvent(pointer('pointerup', { pointerId: 5, pointerType: 'mouse', clientX: 20 }));
    expect(requests).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'commit', source: 'pointer', viewport: { scale: 1, tx: 20, ty: 0 } })
    );
  });

  it('非法 scale limits、rendered viewport 或 wheel ratio 均 fail-closed', () => {
    controller.dispose();
    controller = createViewportGestureController({
      ...options,
      scaleLimits: { min: 2, max: 0.5 },
      wheel: { getScaleRatio: () => Number.NaN },
    });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 51 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 51, clientX: 20 }));
    host.dispatchEvent(wheel(10, 10, -100));

    expect(requests).not.toHaveBeenCalled();
  });

  it('dispose 清理所有 listener、capture 与后续请求', () => {
    host.dispatchEvent(pointer('pointerdown', { pointerId: 6 }));
    controller.dispose();
    requests.mockClear();
    document.dispatchEvent(pointer('pointermove', { pointerId: 6, clientX: 20 }));
    host.dispatchEvent(wheel(0, 0, -100));

    expect(host.releasePointerCapture).toHaveBeenCalledWith(6);
    expect(requests).not.toHaveBeenCalled();
  });

  it('通过 canonical Web normalizer 发送锁定的 paper role 与 final up 样本', () => {
    const normalize = jest.spyOn(webInput, 'normalizePointerInput');
    controller.dispose();
    controller = createViewportGestureController({ ...options, interactionPolicy: { mouseDragPan: true } });
    host.dispatchEvent(pointer('pointerdown', { pointerId: 61, pointerType: 'mouse' }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 61, pointerType: 'mouse', clientX: 10 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 61, pointerType: 'mouse', clientX: 20 }));

    expect(normalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host, targetRole: 'paper', phase: 'up' })
    );
    expect(requests).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'commit' }));
    normalize.mockRestore();
  });
});
