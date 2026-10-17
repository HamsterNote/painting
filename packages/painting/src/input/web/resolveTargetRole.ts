import type { TargetRole } from '../../core';

const RULER_SELECTOR = '[data-testid="drawing-ruler"], [data-testid="drawing-ruler-background"]';
const SELECTION_SELECTOR = [
  '[data-lasso-resize-handle]',
  '[data-lasso-rotate-handle]',
  '[data-text-selection-edge]',
  '[data-testid="text-selection-edge"]',
  '[data-testid="lasso-selection-box"]',
  '[data-testid="text-selection-box"]',
].join(', ');
const SAFE_CONTROL_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable]',
  '[data-interactive]',
].join(', ');

function isElement(target: EventTarget | null): target is Element {
  return typeof Element !== 'undefined' && target instanceof Element;
}

function hasClosest(target: Element, selector: string): boolean {
  return target.closest(selector) !== null;
}

/**
 * 将宿主内 DOM 命中转换为 core 的有限角色集合。
 *
 * 优先级刻意固定：尺子覆盖选框与安全控件，选框覆盖其内部可能出现的交互元素；只有宿主内
 * 且未命中这些对象的位置才是 paper。非 Element（例如 Text 节点）不做猜测。
 */
export function resolveTargetRole(eventTarget: EventTarget | null, host: HTMLElement): TargetRole {
  if (!isElement(eventTarget) || !host.contains(eventTarget)) {
    return 'none';
  }

  if (hasClosest(eventTarget, RULER_SELECTOR)) {
    return 'ruler';
  }
  if (hasClosest(eventTarget, SELECTION_SELECTOR)) {
    return 'selection';
  }
  if (hasClosest(eventTarget, SAFE_CONTROL_SELECTOR)) {
    return 'safe-control';
  }
  return 'paper';
}
