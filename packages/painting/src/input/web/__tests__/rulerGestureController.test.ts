import { createRulerGestureController } from '../rulerGestureController';
import * as webInput from '../normalizePointerInput';

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  overrides: Partial<{
    pointerId: number;
    pointerType: 'mouse' | 'touch' | 'pen';
    clientX: number;
    clientY: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }> = {}
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: overrides.pointerId ?? 1 },
    pointerType: { value: overrides.pointerType ?? 'touch' },
    clientX: { value: overrides.clientX ?? 0 },
    clientY: { value: overrides.clientY ?? 0 },
    button: { value: 0 },
    buttons: { value: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 },
    pressure: { value: 0.5 },
    altKey: { value: overrides.altKey ?? false },
    ctrlKey: { value: overrides.ctrlKey ?? false },
    metaKey: { value: overrides.metaKey ?? false },
    shiftKey: { value: false },
  });
  return event as PointerEvent;
}

describe('input/web/rulerGestureController', () => {
  let host: HTMLDivElement;
  let state: { center: { x: number; y: number }; rotationRad?: number };
  let onState: jest.Mock;
  let controller: ReturnType<typeof createRulerGestureController>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperties(host, {
      clientWidth: { value: 200 },
      clientHeight: { value: 100 },
      clientLeft: { value: 0 },
      clientTop: { value: 0 },
    });
    host.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;
    host.setPointerCapture = jest.fn();
    host.releasePointerCapture = jest.fn();
    host.hasPointerCapture = jest.fn(() => true);
    state = { center: { x: 50, y: 40 }, rotationRad: 0 };
    onState = jest.fn((next) => {
      state = next;
    });
    controller = createRulerGestureController({
      host,
      listenerTarget: host,
      getRulerState: () => state,
      getRotationPivot: () => ({ x: 100, y: 50 }),
      hitTest: (event) => event.clientX >= 10 && event.clientX <= 210,
      toLocalPoint: (event) => ({ x: event.clientX - 10, y: event.clientY - 20 }),
      onState,
      onActiveChange: jest.fn(),
      onRotationFeedback: jest.fn(),
    });
  });

  afterEach(() => {
    controller.dispose();
    host.remove();
  });

  it('policy cancellation isolates old mouse through capture loss until up; lifecycle releases its ID', () => {
    const mouse = {
      pointerType: 'mouse' as const,
      pointerId: 8,
      clientX: 50,
      clientY: 50,
      ctrlKey: true,
    };
    host.dispatchEvent(pointer('pointerdown', mouse));
    controller.cancel();
    host.dispatchEvent(pointer('lostpointercapture', mouse));
    host.dispatchEvent(pointer('pointerdown', mouse));
    document.dispatchEvent(pointer('pointermove', { ...mouse, clientX: 70, clientY: 70 }));
    expect(onState).not.toHaveBeenCalled();
    document.dispatchEvent(pointer('pointerup', mouse));
    host.dispatchEvent(pointer('pointerdown', mouse));
    document.dispatchEvent(pointer('pointermove', { ...mouse, clientX: 70, clientY: 70 }));
    expect(state.center).toEqual({ x: 70, y: 60 });
    controller.cancel({ releaseContacts: true });
    host.dispatchEvent(pointer('pointerdown', mouse));
    document.dispatchEvent(pointer('pointermove', { ...mouse, clientX: 70, clientY: 70 }));
    expect(state.center).toEqual({ x: 90, y: 80 });
  });

  it('仅接管修饰键 primary mouse，Ctrl 平移保持 grab offset，Alt 绕 pivot 吸附', () => {
    host.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 50, clientY: 50 }));
    expect(onState).not.toHaveBeenCalled();

    const ctrlDown = pointer('pointerdown', {
      pointerType: 'mouse',
      pointerId: 2,
      clientX: 50,
      clientY: 50,
      ctrlKey: true,
    });
    host.dispatchEvent(ctrlDown);
    document.dispatchEvent(
      pointer('pointermove', { pointerType: 'mouse', pointerId: 2, clientX: 70, clientY: 70 })
    );
    document.dispatchEvent(
      pointer('pointerup', { pointerType: 'mouse', pointerId: 2, clientX: 70, clientY: 70 })
    );
    expect(onState).toHaveBeenLastCalledWith({ center: { x: 70, y: 60 }, rotationRad: 0 });

    state = { center: { x: 50, y: 40 }, rotationRad: 0 };
    host.dispatchEvent(
      pointer('pointerdown', {
        pointerType: 'mouse',
        pointerId: 3,
        clientX: 110,
        clientY: 80,
        altKey: true,
      })
    );
    document.dispatchEvent(
      pointer('pointermove', {
        pointerType: 'mouse',
        pointerId: 3,
        clientX: 60,
        clientY: 70,
        altKey: true,
      })
    );
    document.dispatchEvent(
      pointer('pointerup', {
        pointerType: 'mouse',
        pointerId: 3,
        clientX: 60,
        clientY: 70,
        altKey: true,
      })
    );
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        center: expect.objectContaining({ x: 110 }),
        rotationRad: Math.PI / 2,
      })
    );
    expect(onState.mock.calls.at(-1)![0].center.y).toBeCloseTo(0);
  });

  it('touch 固定前两个 pointer，第三触点不替换，pair cancel 不产生 final state', () => {
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 20 }));
    host.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 30, clientY: 20 }));
    host.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 30, clientY: 40 }));
    expect(onState).toHaveBeenLastCalledWith({
      center: { x: 50, y: 50 },
      rotationRad: Math.PI / 4,
    });

    const countBeforeCancel = onState.mock.calls.length;
    document.dispatchEvent(pointer('pointercancel', { pointerId: 1, clientX: 10, clientY: 20 }));
    expect(onState).toHaveBeenCalledTimes(countBeforeCancel);
  });

  it('以 final up 样本提交双指尺子位置', () => {
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 20 }));
    host.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 30, clientY: 20 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 50, clientY: 20 }));

    expect(onState).toHaveBeenLastCalledWith({ center: { x: 60, y: 40 }, rotationRad: 0 });
  });

  it('通过 canonical Web normalizer 发送带 ruler role 的 lifecycle 样本', () => {
    const normalize = jest.spyOn(webInput, 'normalizePointerInput');
    host.dispatchEvent(
      pointer('pointerdown', { pointerType: 'mouse', ctrlKey: true, clientX: 50, clientY: 50 })
    );
    document.dispatchEvent(
      pointer('pointermove', { pointerType: 'mouse', clientX: 70, clientY: 70 })
    );
    document.dispatchEvent(
      pointer('pointerup', { pointerType: 'mouse', clientX: 70, clientY: 70 })
    );

    expect(normalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host, targetRole: 'ruler', point: expect.any(Object) })
    );
    expect(normalize.mock.calls.map(([, options]) => options.phase)).toEqual([
      'down',
      'move',
      'up',
    ]);
    normalize.mockRestore();
  });
});
