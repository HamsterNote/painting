import type { ComponentType } from 'react';
import {
  VirtualPaper,
  VirtualPaperInitialPlacement,
  VirtualPaperInteractionMode,
  VirtualPaperRenderMode,
  type VirtualPaperProps,
  type VirtualPaperTransform,
} from '@hamster-note/virtual-paper';
import {
  virtualPaperTransformToViewport,
  viewportToVirtualPaperTransform,
  type DrawingViewport,
} from './viewport';
import {
  SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS,
  type DrawingSurfaceVirtualPaperInteraction,
  type DrawingSurfaceVirtualPaperOptions,
} from './virtualPaperOptions';

const INTERACTION_MODE_BY_OPTION = {
  mouseWheelZoom: VirtualPaperInteractionMode.MouseWheelZoom,
  mouseDragPan: VirtualPaperInteractionMode.MouseDragPan,
  trackpadScrollPan: VirtualPaperInteractionMode.TrackpadScrollPan,
  mouseWheelCtrlZoom: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  touchSingleFingerPan: VirtualPaperInteractionMode.TouchSingleFingerPan,
  touchTwoFingerPan: VirtualPaperInteractionMode.TouchTwoFingerPan,
  touchTwoFingerZoom: VirtualPaperInteractionMode.TouchTwoFingerZoom,
  penPan: VirtualPaperInteractionMode.PenPan,
} as const satisfies Record<
  DrawingSurfaceVirtualPaperInteraction,
  (typeof VirtualPaperInteractionMode)[keyof typeof VirtualPaperInteractionMode]
>;

export const VirtualPaperRenderer: ComponentType<VirtualPaperProps> = VirtualPaper;

export function isVirtualPaperEnabled(
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions
): boolean {
  if (virtualPaper === true) {
    return true;
  }

  if (virtualPaper === false || virtualPaper === undefined) {
    return false;
  }

  return virtualPaper.enabled !== false;
}

export function toVirtualPaperProps(
  options: DrawingSurfaceVirtualPaperOptions,
  viewport: DrawingViewport,
  onViewportChange: (viewport: DrawingViewport) => void
): VirtualPaperProps {
  return {
    renderMode: VirtualPaperRenderMode.Transform,
    enabledInteractions: mapEnabledInteractions(options.enabledInteractions),
    ...(options.initialPlacement === undefined
      ? {}
      : { initialPlacement: mapInitialPlacement(options.initialPlacement) }),
    ...(isFiniteNumber(options.minScale) ? { minScale: options.minScale } : {}),
    ...(isFiniteNumber(options.maxScale) ? { maxScale: options.maxScale } : {}),
    transform: viewportToVirtualPaperTransform(viewport) satisfies VirtualPaperTransform,
    onTransformChange: (transform) => {
      onViewportChange(virtualPaperTransformToViewport(transform));
    },
  };
}

function mapInitialPlacement(
  placement: DrawingSurfaceVirtualPaperOptions['initialPlacement']
): VirtualPaperProps['initialPlacement'] {
  switch (placement) {
    case 'top-left':
      return VirtualPaperInitialPlacement.TopLeft;
    case 'center':
      return VirtualPaperInitialPlacement.Center;
    case undefined:
      return undefined;
  }
}

function mapEnabledInteractions(
  interactions: DrawingSurfaceVirtualPaperOptions['enabledInteractions']
): VirtualPaperProps['enabledInteractions'] {
  const resolvedInteractions = interactions ?? SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS;
  return resolvedInteractions.map((interaction) => INTERACTION_MODE_BY_OPTION[interaction]);
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
