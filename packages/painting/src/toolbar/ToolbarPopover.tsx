import { paneToolbarStyles } from './styles';
import type { PaneToolbarLayout } from './types';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** No backdrop: an outside pointer closes the panel without consuming the canvas event. */
export function ToolbarPopover({
  id,
  label,
  menu,
  anchor,
  boundary,
  onClose,
  children,
  layout,
  className = '',
}: {
  id: string;
  label: string;
  menu: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  boundary: RefObject<HTMLDivElement | null>;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
  layout?: PaneToolbarLayout;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 288, maxHeight: 400 });
  useLayoutEffect(() => {
    const element = panel.current;
    const trigger = anchor.current;
    if (!element || !trigger) return;
    const view = trigger.ownerDocument.defaultView!;
    const doc = trigger.ownerDocument;
    const place = () => {
      const visual = view.visualViewport;
      const container =
        boundary.current?.closest('[data-pane-toolbar-boundary]') ??
        boundary.current?.parentElement;
      const measured = container?.getBoundingClientRect();
      const board = layout?.bounds
        ? {
            ...layout.bounds,
            right: layout.bounds.left + layout.bounds.width,
            bottom: layout.bounds.top + layout.bounds.height,
          }
        : measured;
      const viewportTop = visual?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (visual?.height ?? view.innerHeight);
      const visibleTop = Math.max(viewportTop, board?.top ?? viewportTop);
      const visibleBottom = Math.min(viewportBottom, board?.bottom ?? viewportBottom);
      const left = Math.max(visual?.offsetLeft ?? 0, board?.left ?? 0) + 8;
      const right =
        Math.min(
          (visual?.offsetLeft ?? 0) + (visual?.width ?? view.innerWidth),
          board?.right ?? view.innerWidth
        ) - 8;
      const top = visibleTop + 8;
      const bottom = visibleBottom - 8;
      const width = Math.max(0, Math.min(288, right - left));
      const rect = trigger.getBoundingClientRect();
      const rectTop = Math.max(top, Math.min(rect.top - 8, bottom));
      const rectBottom = Math.max(top, Math.min(rect.bottom + 8, bottom));
      const below = layout?.edge === 'top';
      const preferred = below ? bottom - rectBottom : rectTop - top;
      const opposite = below ? rectTop - top : bottom - rectBottom;
      const down =
        preferred >= Math.min(100, element.scrollHeight) || preferred >= opposite ? below : !below;
      const start = down ? rectBottom : top;
      const end = down ? bottom : rectTop;
      const maxHeight = Math.max(0, end - start);
      const height = Math.min(element.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(left, Math.min(rect.left, right - width)),
        top: down ? start : Math.max(top, end - height),
        width,
        maxHeight,
      });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(element);
    if (boundary.current) {
      observer?.observe(boundary.current);
      const board =
        boundary.current.closest('[data-pane-toolbar-boundary]') ?? boundary.current.parentElement;
      if (board) observer?.observe(board);
    }
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!element.contains(event.target) && !boundary.current?.contains(event.target))
        onClose(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !element.contains(event.target) &&
        !boundary.current?.contains(event.target)
      )
        onClose(false);
    };
    let tabExit: number | undefined;
    // Traversal past the document's last control blurs to BODY, which would leave
    // a keyboard user without a landing point. Return to the trigger like Escape
    // (and like the reverse direction's normal exit).
    const leaveAfterTab = () => {
      tabExit = undefined;
      const active = doc.activeElement;
      if (element.contains(active)) return;
      onClose(!active || active === doc.body);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && element.contains(doc.activeElement)) {
        // Preserve native traversal, then close even when it lands in this toolbar.
        // Pointer focus in the toolbar remains allowed by focusOutside above.
        view.clearTimeout(tabExit);
        tabExit = view.setTimeout(leaveAfterTab, 0);
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
    };
    const blur = () => {
      // Leaving the document (e.g. to browser chrome) fires window blur before the
      // traversal timer, so a pending Tab exit must still restore the trigger.
      if (tabExit === undefined) onClose(false);
      else {
        view.clearTimeout(tabExit);
        leaveAfterTab();
      }
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', focusOutside);
    doc.addEventListener('keydown', keyDown);
    view.addEventListener('blur', blur);
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    view.visualViewport?.addEventListener('resize', place);
    view.visualViewport?.addEventListener('scroll', place);
    if (menu) element.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    else
      element
        .querySelector<HTMLElement>(
          'input:not([type="radio"]),input[type="radio"]:checked,select,button'
        )
        ?.focus();
    return () => {
      view.clearTimeout(tabExit);
      observer?.disconnect();
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', focusOutside);
      doc.removeEventListener('keydown', keyDown);
      view.removeEventListener('blur', blur);
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      view.visualViewport?.removeEventListener('resize', place);
      view.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, boundary, menu, onClose, layout]);
  return (
    <div
      ref={panel}
      id={id}
      role={menu ? 'menu' : 'dialog'}
      aria-label={label}
      data-interactive="true"
      className={`hn-pane-toolbar hn-pane-panel ${className}`}
      style={{
        position: 'fixed',
        ...position,
        zIndex: 30,
        overflowY: 'auto',
        pointerEvents: 'auto',
      }}
      onKeyDown={(event) => {
        if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role^="menuitem"]:not(:disabled)'
          ),
        ];
        const current = items.indexOf(
          event.currentTarget.ownerDocument.activeElement as HTMLButtonElement
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <style>{paneToolbarStyles}</style>
      {children}
    </div>
  );
}
