import type { DrawingSurfaceProps, DrawingSurfaceVirtualPaperOptions } from '../index';

const omittedVirtualPaperProps: DrawingSurfaceProps = {};
const enabledVirtualPaperProps: DrawingSurfaceProps = { virtualPaper: true };
const disabledVirtualPaperProps: DrawingSurfaceProps = { virtualPaper: false };
const disabledObjectVirtualPaperProps: DrawingSurfaceProps = { virtualPaper: { enabled: false } };

const publicVirtualPaperOptions: DrawingSurfaceVirtualPaperOptions = {
  enabled: true,
  initialPlacement: 'center',
  minScale: 0.5,
  maxScale: 4,
  enabledInteractions: ['trackpadScrollPan', 'mouseWheelCtrlZoom'],
};

const configuredVirtualPaperProps: DrawingSurfaceProps = {
  virtualPaper: publicVirtualPaperOptions,
};

export const virtualPaperPublicApiTypecheck = [
  omittedVirtualPaperProps,
  enabledVirtualPaperProps,
  disabledVirtualPaperProps,
  disabledObjectVirtualPaperProps,
  configuredVirtualPaperProps,
];
