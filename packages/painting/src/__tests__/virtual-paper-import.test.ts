import {
  isInsideRuler,
  isVirtualPaperEnabled,
  viewportToVirtualPaperTransform,
  virtualPaperTransformToViewport,
} from '@hamster-note/painting';
import { VirtualPaper } from '../layered/NavigationOverlay';

describe('internal virtual paper contract', () => {
  it('uses the internal display-only Frame and retains public option enablement', () => {
    expect(VirtualPaper).toBeDefined();
    expect(isVirtualPaperEnabled(true)).toBe(true);
    expect(isVirtualPaperEnabled({ enabled: false })).toBe(false);

    const viewport = virtualPaperTransformToViewport({ x: 24, y: -12, scale: 2 });
    expect(viewport).toEqual({ tx: 24, ty: -12, scale: 2 });
    expect(viewportToVirtualPaperTransform(viewport)).toEqual({ x: 24, y: -12, scale: 2 });

    expect(
      isInsideRuler(
        { x: 10, y: 5 },
        {
          center: { x: 0, y: 0 },
          length: 100,
          height: 20,
        }
      )
    ).toBe(true);
  });
});
