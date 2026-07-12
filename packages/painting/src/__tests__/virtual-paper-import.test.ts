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
});
