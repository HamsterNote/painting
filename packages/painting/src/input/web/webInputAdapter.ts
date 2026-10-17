import type { NormalizedPointerInput } from '../../core/internal';
import { normalizePointerInput } from './normalizePointerInput';
import type { NormalizePointerInputOptions } from './normalizePointerInput';

export type WebInputAdapter = Readonly<{
  destroy: () => void;
  getActivePointerIds: () => readonly number[];
}>;

export type CreateWebInputAdapterOptions = Readonly<
  Omit<NormalizePointerInputOptions, 'host'> & {
    host: HTMLElement;
    onInput: (input: NormalizedPointerInput) => void;
  }
>;

function asCancel(input: NormalizedPointerInput): NormalizedPointerInput {
  return { ...input, phase: 'cancel' };
}

/**
 * Web 平台的 pointer 生命周期边界。此层只追踪已规范化的浏览器 pointer，不参与 core 的
 * ownership 或 GestureSession 决策，因此 move 命中的角色可以如实变化并由 core 锁定 owner。
 */
export function createWebInputAdapter(options: CreateWebInputAdapterOptions): WebInputAdapter {
  const { host, onInput, now, resolveTargetRole } = options;
  const active = new Map<number, NormalizedPointerInput>();
  let destroyed = false;

  const normalize = (event: PointerEvent) =>
    normalizePointerInput(event, { host, now, resolveTargetRole });

  const releasePointerCapture = (pointerId: number) => {
    try {
      if (host.hasPointerCapture?.(pointerId)) {
        host.releasePointerCapture(pointerId);
      }
    } catch {
      // 浏览器可能已因 up/cancel 自动释放；无论如何都要结束本地生命周期。
    }
  };

  const cancelActivePointer = (pointerId: number) => {
    const last = active.get(pointerId);
    if (!last) {
      return;
    }
    active.delete(pointerId);
    onInput(asCancel(last));
    releasePointerCapture(pointerId);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (destroyed || active.has(event.pointerId)) {
      return;
    }
    const input = normalize(event);
    if (!input) {
      return;
    }
    active.set(event.pointerId, input);
    onInput(input);
    try {
      host.setPointerCapture?.(event.pointerId);
    } catch {
      // 捕获不可用时仍由 host 已注册的生命周期事件继续工作。
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (destroyed || !active.has(event.pointerId)) {
      return;
    }
    const input = normalize(event);
    if (!input) {
      return;
    }
    active.set(event.pointerId, input);
    onInput(input);
  };

  const handlePointerEnd = (event: PointerEvent) => {
    if (destroyed || !active.has(event.pointerId)) {
      return;
    }
    const input = normalize(event);
    if (input) {
      active.set(event.pointerId, input);
      onInput(input);
    }
    active.delete(event.pointerId);
    releasePointerCapture(event.pointerId);
  };

  const handleLostPointerCapture = (event: PointerEvent) => {
    if (!destroyed) {
      cancelActivePointer(event.pointerId);
    }
  };

  const handleWindowBlur = () => {
    if (!destroyed) {
      [...active.keys()].forEach(cancelActivePointer);
    }
  };

  host.addEventListener('pointerdown', handlePointerDown);
  host.addEventListener('pointermove', handlePointerMove);
  host.addEventListener('pointerup', handlePointerEnd);
  host.addEventListener('pointercancel', handlePointerEnd);
  host.addEventListener('lostpointercapture', handleLostPointerCapture);
  window.addEventListener('blur', handleWindowBlur);

  return Object.freeze({
    destroy: () => {
      if (destroyed) {
        return;
      }
      [...active.keys()].forEach(cancelActivePointer);
      destroyed = true;
      host.removeEventListener('pointerdown', handlePointerDown);
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerup', handlePointerEnd);
      host.removeEventListener('pointercancel', handlePointerEnd);
      host.removeEventListener('lostpointercapture', handleLostPointerCapture);
      window.removeEventListener('blur', handleWindowBlur);
    },
    getActivePointerIds: () => Object.freeze([...active.keys()]),
  });
}
