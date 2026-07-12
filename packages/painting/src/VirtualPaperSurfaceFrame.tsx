import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { VirtualPaperRenderer, toVirtualPaperProps } from './virtualPaperAdapter';
import type { DrawingSurfaceVirtualPaperOptions } from './virtualPaperOptions';
import type { DrawingViewport } from './viewport';

export type VirtualPaperSurfaceFrameProps = {
  readonly enabled: boolean;
  readonly options: DrawingSurfaceVirtualPaperOptions;
  readonly viewport: DrawingViewport;
  readonly onViewportChange: (viewport: DrawingViewport) => void;
  readonly containerStyle?: CSSProperties;
  readonly children: ReactNode;
};

export function VirtualPaperSurfaceFrame({
  enabled,
  options,
  viewport,
  onViewportChange,
  containerStyle,
  children,
}: VirtualPaperSurfaceFrameProps): ReactElement {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <VirtualPaperRenderer
      {...toVirtualPaperProps(options, viewport, onViewportChange)}
      containerStyle={containerStyle}
    >
      {children}
    </VirtualPaperRenderer>
  );
}
