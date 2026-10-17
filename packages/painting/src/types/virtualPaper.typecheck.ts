import {
  createEditor,
  type DrawingSurfaceProps,
  type DrawingSurfaceVirtualPaperOptions,
} from '../index';

const controller = createEditor();

const omittedVirtualPaperProps: DrawingSurfaceProps = { controller };
const enabledVirtualPaperProps: DrawingSurfaceProps = { controller, virtualPaper: true };
const disabledVirtualPaperProps: DrawingSurfaceProps = { controller, virtualPaper: false };
const disabledObjectVirtualPaperProps: DrawingSurfaceProps = {
  controller,
  virtualPaper: { enabled: false },
};

const publicVirtualPaperOptions: DrawingSurfaceVirtualPaperOptions = {
  enabled: true,
  initialPlacement: 'center',
  minScale: 0.5,
  maxScale: 4,
  enabledInteractions: ['trackpadScrollPan', 'mouseWheelCtrlZoom'],
};

const configuredVirtualPaperProps: DrawingSurfaceProps = {
  controller,
  virtualPaper: publicVirtualPaperOptions,
};

export const virtualPaperPublicApiTypecheck = [
  omittedVirtualPaperProps,
  enabledVirtualPaperProps,
  disabledVirtualPaperProps,
  disabledObjectVirtualPaperProps,
  configuredVirtualPaperProps,
];
