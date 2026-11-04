import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** No backdrop: an outside pointer closes the panel without consuming the canvas event. */
export function ToolbarPanel({
  id,
  label,
  menu,
  anchor,
  boundary,
  onClose,
  children,
}: {
  id: string;
  label: string;
  menu: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  boundary: RefObject<HTMLDivElement | null>;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
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
      const board = boundary.current?.closest('[data-painting-board]')?.getBoundingClientRect();
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
      const available = Math.max(44, bottom - top);
      // Prefer above the trigger, but use all visible space when the keyboard covers it.
      // Both modes share this visible end; a popup above the trigger cannot
      // keep an old, taller height after the host extends below the viewport.
      const end = rect.top - 8 > top + 100 ? Math.max(top, Math.min(rect.top - 8, bottom)) : bottom;
      const maxHeight = Math.min(available, Math.max(44, end - top));
      const height = Math.min(element.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(left, Math.min(rect.left, right - width)),
        top: Math.max(top, end - height),
        width,
        maxHeight,
      });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(element);
    if (boundary.current) {
      observer?.observe(boundary.current);
      const board = boundary.current.closest('[data-painting-board]');
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
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
    };
    const blur = () => onClose(false);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', focusOutside);
    doc.addEventListener('keydown', escape);
    view.addEventListener('blur', blur);
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    view.visualViewport?.addEventListener('resize', place);
    view.visualViewport?.addEventListener('scroll', place);
    if (menu)
      element.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')?.focus();
    else element.querySelector<HTMLElement>('input,select,button')?.focus();
    return () => {
      observer?.disconnect();
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', focusOutside);
      doc.removeEventListener('keydown', escape);
      view.removeEventListener('blur', blur);
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      view.visualViewport?.removeEventListener('resize', place);
      view.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, boundary, menu, onClose]);
  return (
    <div
      ref={panel}
      id={id}
      role={menu ? 'menu' : 'dialog'}
      aria-label={label}
      data-interactive="true"
      className="hn-painting-toolbar hn-painting-panel"
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
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
        ];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {children}
    </div>
  );
}
