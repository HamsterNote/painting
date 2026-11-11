import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import type { PaneToolbarLayout, ToolbarOccupiedSpace } from './types';
import { paneToolbarStyles } from './styles';

export type ToolbarShellProps = {
  children: ReactNode;
  auxiliary?: ReactNode;
  overlay?: ReactNode;
  collapsed?: boolean;
  placement?: 'inline' | 'floating';
  layout?: PaneToolbarLayout;
  label?: string;
  className?: string;
  toolbarProps?: HTMLAttributes<HTMLDivElement>;
  onOccupiedSpaceChange?: (space: ToolbarOccupiedSpace) => void;
};

/** DOM shell shared by content libraries; no editor, storage or routing dependencies. */
export const ToolbarShell = forwardRef<HTMLDivElement, ToolbarShellProps>(function ToolbarShell(
  {
    children,
    auxiliary,
    overlay,
    collapsed = false,
    placement = 'inline',
    layout,
    label = '工具栏',
    className,
    toolbarProps,
    onOccupiedSpaceChange,
  },
  ref
) {
  const root = useRef<HTMLDivElement>(null);
  const lastReported = useRef<ToolbarOccupiedSpace | null>(null);
  useImperativeHandle(ref, () => root.current!, []);
  const edge = layout?.edge ?? 'bottom';
  const inset = layout
    ? edge === 'top'
      ? Math.max(layout.insets.top, layout.headerContentInset)
      : layout.insets.bottom
    : 0;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !onOccupiedSpaceChange) return;
    const view = element.ownerDocument.defaultView!;
    const report = () => {
      const measuredOffset = parseFloat(view.getComputedStyle(element)[edge]);
      const offset = Number.isFinite(measuredOffset) ? measuredOffset : 16 + inset;
      const size =
        placement === 'floating'
          ? element.getBoundingClientRect().height + offset
          : element.getBoundingClientRect().height;
      const space = {
        top: edge === 'top' ? size : 0,
        bottom: edge === 'bottom' ? size : 0,
      };
      if (lastReported.current?.top === space.top && lastReported.current.bottom === space.bottom)
        return;
      lastReported.current = space;
      onOccupiedSpaceChange(space);
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(element);
    view.addEventListener('resize', report);
    view.visualViewport?.addEventListener('resize', report);
    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', report);
      view.visualViewport?.removeEventListener('resize', report);
    };
  }, [collapsed, edge, inset, placement, onOccupiedSpaceChange]);
  return (
    <div
      ref={root}
      className={className}
      data-toolbar-placement={placement}
      data-toolbar-edge={edge}
      role="region"
      aria-label={`${label}，可横向滚动`}
      style={{
        ...(placement === 'floating'
          ? {
              position: 'absolute',
              left: layout?.insets.left ?? 0,
              right: layout?.insets.right ?? 0,
              [edge]: layout ? 16 + inset : 'calc(16px + env(safe-area-inset-bottom, 0px))',
              zIndex: 20,
              pointerEvents: 'none',
            }
          : { position: 'relative', maxWidth: '100%' }),
        display: 'flex',
        alignItems: 'center',
        flexDirection: edge === 'top' ? 'column-reverse' : 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <style>{paneToolbarStyles}</style>
      {auxiliary}
      {!collapsed ? (
        <div
          {...toolbarProps}
          role="toolbar"
          aria-label={label}
          data-interactive="true"
          className={`hn-pane-toolbar ${toolbarProps?.className ?? ''}`}
          onFocusCapture={(event) => {
            const strip = event.currentTarget;
            const rect = (event.target as HTMLElement).getBoundingClientRect();
            const bounds = strip.getBoundingClientRect();
            if (rect.left < bounds.left + 8) strip.scrollLeft -= bounds.left + 8 - rect.left;
            if (rect.right > bounds.right - 8) strip.scrollLeft += rect.right - bounds.right + 8;
            toolbarProps?.onFocusCapture?.(event);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'nowrap',
            flex: '0 1 auto',
            minWidth: 0,
            width: 'max-content',
            maxWidth: 'calc(100% - 32px)',
            height: 60,
            padding: '7px 12px',
            boxSizing: 'border-box',
            borderRadius: 30,
            border: '1px solid #E2E5EA',
            background: '#F5F6F8',
            boxShadow: '0 6px 24px rgba(15,23,42,0.12)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            pointerEvents: 'auto',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            ...toolbarProps?.style,
          }}
        >
          {children}
        </div>
      ) : null}
      {overlay}
    </div>
  );
});
