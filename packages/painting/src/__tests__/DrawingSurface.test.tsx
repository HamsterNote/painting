import { DrawingSurface } from '../components/DrawingSurface';
import { DrawingSurface as DrawingSurfaceFromIndex } from '@hamster-note/painting';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  Platform: { OS: 'android', select: (o: any) => o.android || o.default },
}));

describe('DrawingSurface', () => {
  it('is a function (exported correctly)', () => {
    expect(typeof DrawingSurface).toBe('function');
  });

  it('is a function when imported from index', () => {
    expect(typeof DrawingSurfaceFromIndex).toBe('function');
  });

  it('accepts testID prop', () => {
    const result = DrawingSurface({ testID: 'drawing-surface-smoke' });
    expect(result).toBeTruthy();
  });

  it('renders without props', () => {
    const result = DrawingSurface({});
    expect(result).toBeTruthy();
  });
});
