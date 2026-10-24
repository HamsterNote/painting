import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
  requireNativeViewManager: jest.fn(() => () => null),
}));

beforeEach(() => jest.clearAllMocks());

test.each([
  null,
  { demoBridgeVersion: 1 },
  { demoBridgeVersion: 2 },
  { demoBridgeVersion: 3 },
  { demoBridgeVersion: 4 },
])('native Demo requires the reentrant-safe sampler binary: %j', (module) => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(module);
  let available = false;
  jest.isolateModules(() => {
    const view = require('../../../packages/painting-pencilkit/src/PaintingPencilkitView');
    available = view.isPencilkitDemoAvailable();
  });
  expect(available).toBe(module?.demoBridgeVersion === 4);
  expect(requireNativeViewManager).toHaveBeenCalledTimes(module ? 1 : 0);
});
