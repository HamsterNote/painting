import { createSelectionGestureController } from '../selectionGestureController';
import * as webInput from '../normalizePointerInput';

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  overrides: Partial<{ pointerId: number; clientX: number; clientY: number; ctrlKey: boolean }> = {}
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: overrides.pointerId ?? 1 },
    pointerType: { value: 'mouse' },
    clientX: { value: overrides.clientX ?? 10 },
    clientY: { value: overrides.clientY ?? 10 },
    button: { value: 0 },
    buttons: { value: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 },
    pressure: { value: 0.5 },
    altKey: { value: false },
    ctrlKey: { value: overrides.ctrlKey ?? false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  return event as PointerEvent;
}

describe('input/web/selectionGestureController', () => {
  let host: HTMLDivElement;
  let handle: HTMLDivElement;
  let preview: jest.Mock;
  let commit: jest.Mock;
  let start: jest.Mock;
  let end: jest.Mock;
  let controller: ReturnType<typeof createSelectionGestureController>;

  beforeEach(() => {
    host = document.createElement('div');
    handle = document.createElement('div');
    handle.dataset.lassoResizeHandle = 'e';
    host.append(handle);
    document.body.append(host);
    host.setPointerCapture = jest.fn();
    host.releasePointerCapture = jest.fn();
    host.hasPointerCapture = jest.fn(() => true);
    preview = jest.fn();
    commit = jest.fn();
    start = jest.fn();
    end = jest.fn();
    controller = createSelectionGestureController({
      host,
      listenerTarget: host,
      toLocalPoint: (event) => ({ x: event.clientX, y: event.clientY }),
      describe: (event) =>
        // DrawingSurface 的 classifier 遇到尺子命中会返回 null；controller 不得抢占。
        event.target === handle && event.ctrlKey !== true
          ? {
              kind: 'resize',
              box: { center: { x: 10, y: 10 }, width: 20, height: 10, rotationRad: 0 },
              anchor: { x: 0, y: 5 },
              axis: { x: 1, y: 1 },
              minimumSize: 4,
            }
          : null,
      onPreview: preview,
      onCommit: commit,
      onStart: start,
      onEnd: end,
    });
  });

  afterEach(() => {
    controller.dispose();
    host.remove();
  });

  it('仅由 handle gate 接管，move 只预览，up 用 final sample 一次提交', () => {
    const outside = document.createElement('div');
    host.append(outside);
    outside.dispatchEvent(pointer('pointerdown'));
    expect(start).not.toHaveBeenCalled();

    const down = pointer('pointerdown', { pointerId: 2, clientX: 20, clientY: 10 });
    handle.dispatchEvent(down);
    document.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 30, clientY: 10 }));
    expect(preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'resize', scale: { x: 1.5, y: 0.5 } })
    );
    expect(commit).not.toHaveBeenCalled();
    document.dispatchEvent(pointer('pointerup', { pointerId: 2, clientX: 40, clientY: 10 }));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'resize', scale: { x: 2, y: 0.5 } })
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(true);
    expect(down.defaultPrevented).toBe(true);
  });

  it('尊重外部 ruler classifier gate，不接管重叠 selection handle', () => {
    const rulerOwned = pointer('pointerdown', { pointerId: 9, ctrlKey: true });
    handle.dispatchEvent(rulerOwned);

    expect(start).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(rulerOwned.defaultPrevented).toBe(false);
  });

  it('cancel 不提交且结束一次；最小尺寸不会出现零或负 scale', () => {
    handle.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 20, clientY: 10 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: -100, clientY: -100 }));
    document.dispatchEvent(
      pointer('pointercancel', { pointerId: 3, clientX: -100, clientY: -100 })
    );

    expect(preview.mock.calls.at(-1)?.[0]).toMatchObject({ scale: { x: 0.2, y: 0.4 } });
    expect(commit).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(false);
  });

  it('通过 canonical Web normalizer 发送 selection role 的 final up 样本', () => {
    const normalize = jest.spyOn(webInput, 'normalizePointerInput');
    handle.dispatchEvent(pointer('pointerdown', { pointerId: 4, clientX: 20, clientY: 10 }));
    document.dispatchEvent(pointer('pointermove', { pointerId: 4, clientX: 30, clientY: 10 }));
    document.dispatchEvent(pointer('pointerup', { pointerId: 4, clientX: 40, clientY: 10 }));

    expect(normalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host, targetRole: 'selection', phase: 'up' })
    );
    expect(commit).toHaveBeenCalledTimes(1);
    normalize.mockRestore();
  });
});
