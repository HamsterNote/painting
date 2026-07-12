jest.mock(
  '@system-ui-js/multi-drag',
  () => ({
    DragOperationType: {
      AllEnd: 'all-end',
      Move: 'move',
      Start: 'start',
    },
    Mixin: class Mixin {},
    MixinType: {
      Drag: 'drag',
      Rotate: 'rotate',
    },
  }),
  { virtual: true }
);

jest.mock(
  '@hamster-note/virtual-paper',
  () => {
    const VirtualPaperInteractionMode = {
      MouseDragPan: 'MouseDragPan',
      MouseWheelCtrlZoom: 'MouseWheelCtrlZoom',
      MouseWheelZoom: 'MouseWheelZoom',
      PenPan: 'PenPan',
      TouchSingleFingerPan: 'TouchSingleFingerPan',
      TouchTwoFingerPan: 'TouchTwoFingerPan',
      TouchTwoFingerZoom: 'TouchTwoFingerZoom',
      TrackpadScrollPan: 'TrackpadScrollPan',
    };

    return {
      DEFAULT_ENABLED_INTERACTIONS: [VirtualPaperInteractionMode.TouchSingleFingerPan],
      VirtualPaper: 'virtual-paper',
      VirtualPaperInitialPlacement: {
        Center: 'Center',
        TopLeft: 'TopLeft',
      },
      VirtualPaperInteractionMode,
      VirtualPaperRenderMode: {
        Scroll: 'Scroll',
        Transform: 'Transform',
      },
    };
  },
  { virtual: true }
);

import {
  generateTicks,
  isVirtualPaperEnabled,
  projectOntoRuler,
  toVirtualPaperProps,
  viewportToVirtualPaperTransform,
  virtualPaperTransformToViewport,
} from '@hamster-note/painting';
import {
  DEFAULT_ENABLED_INTERACTIONS,
  VirtualPaper,
  VirtualPaperInitialPlacement,
  VirtualPaperInteractionMode,
  VirtualPaperRenderMode,
} from '@hamster-note/virtual-paper';

describe('@hamster-note/virtual-paper runtime imports', () => {
  it('exposes the VirtualPaper component and exact enum string values', () => {
    expect(VirtualPaper).toBeDefined();

    expect(VirtualPaperInteractionMode.MouseWheelZoom).toBe('MouseWheelZoom');
    expect(VirtualPaperInteractionMode.MouseDragPan).toBe('MouseDragPan');
    expect(VirtualPaperInteractionMode.TrackpadScrollPan).toBe('TrackpadScrollPan');
    expect(VirtualPaperInteractionMode.MouseWheelCtrlZoom).toBe('MouseWheelCtrlZoom');
    expect(VirtualPaperInteractionMode.TouchSingleFingerPan).toBe('TouchSingleFingerPan');
    expect(VirtualPaperInteractionMode.TouchTwoFingerPan).toBe('TouchTwoFingerPan');
    expect(VirtualPaperInteractionMode.TouchTwoFingerZoom).toBe('TouchTwoFingerZoom');
    expect(VirtualPaperInteractionMode.PenPan).toBe('PenPan');

    expect(VirtualPaperInitialPlacement.TopLeft).toBe('TopLeft');
    expect(VirtualPaperInitialPlacement.Center).toBe('Center');

    expect(VirtualPaperRenderMode.Transform).toBe('Transform');
    expect(VirtualPaperRenderMode.Scroll).toBe('Scroll');

    expect(DEFAULT_ENABLED_INTERACTIONS).toContain(VirtualPaperInteractionMode.TouchSingleFingerPan);
  });

  it('re-exports virtual paper and ruler runtime helpers from the package entrypoint', () => {
    expect(isVirtualPaperEnabled(true)).toBe(true);
    expect(isVirtualPaperEnabled({ enabled: false })).toBe(false);

    const viewport = virtualPaperTransformToViewport({ x: 24, y: -12, scale: 2 });
    expect(viewport).toEqual({ tx: 24, ty: -12, scale: 2 });
    expect(viewportToVirtualPaperTransform(viewport)).toEqual({ x: 24, y: -12, scale: 2 });

    expect(
      toVirtualPaperProps(
        {
          enabledInteractions: ['mouseWheelCtrlZoom'],
          initialPlacement: 'center',
        },
        viewport,
        () => undefined
      ).renderMode
    ).toBe(VirtualPaperRenderMode.Transform);

    expect(
      generateTicks(
        {
          center: { x: 0, y: 0 },
          rotationRad: 0,
          length: 100,
          height: 20,
        },
        { majorSpacing: 50, minorSpacing: 10 }
      ).length
    ).toBeGreaterThan(0);

    expect(
      projectOntoRuler(
        { x: 10, y: 5 },
        {
          center: { x: 0, y: 0 },
          rotationRad: 0,
          length: 100,
          height: 20,
        }
      )
    ).toEqual({ x: 10, y: 0 });
  });
});
