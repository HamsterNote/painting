export type DrawingSurfaceVirtualPaperInteraction =
  | 'mouseWheelZoom'
  | 'mouseDragPan'
  | 'trackpadScrollPan'
  | 'mouseWheelCtrlZoom'
  | 'touchSingleFingerPan'
  | 'touchTwoFingerPan'
  | 'touchTwoFingerZoom'
  | 'penPan';

export type DrawingSurfaceVirtualPaperOptions = {
  readonly enabled?: boolean;
  readonly initialPlacement?: 'top-left' | 'center';
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly enabledInteractions?: readonly DrawingSurfaceVirtualPaperInteraction[];
};

export const SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS = [
  'trackpadScrollPan',
  'mouseWheelCtrlZoom',
  'touchSingleFingerPan',
  'touchTwoFingerZoom',
] as const satisfies readonly DrawingSurfaceVirtualPaperInteraction[];
