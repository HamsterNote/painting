/**
 * NativeAdapterSmokeSurface 组件层挂载证据（阶段 9 有界实施）。
 *
 * 证据边界（务必如实理解）：
 *   - 本用例只证明「用现有 native Jest project（jest-expo + RNTL）可以正常挂载并渲染
 *     NativeAdapterSmokeSurface 组件」：稳定 testID、文案、可访问性属性、以及 Pressable
 *     reset 被点击后状态更新。
 *   - 这不是 iOS / Android 真机或模拟器交互证据：不做任何真实触摸注入，不触发、也不声称
 *     RNGH 的 Gesture 行为（Pan / onTouches* / finalize）。因此 pointer 事件流不会被本测试
 *     驱动，事件流保持「尚无输入事件」是预期结果。
 *   - RNGH 采用最小 mock，仅为让组件能正常 mount（Gesture 链、GestureDetector、
 *     GestureHandlerRootView）。核心 core / input.native 业务逻辑不 mock，按真实源码执行。
 */
import { fireEvent, render } from '@testing-library/react-native';

// 最小 RNGH mock：只满足 mount 所需的导出面。
// 注意：这里刻意不实现任何触摸/手势行为，避免让用例假装成设备交互证据。
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');

  // Gesture.Pan() 的链式构建器：所有配置方法返回自身，最终对象原样传给被 mock 的
  // GestureDetector（不消费、不执行任何手势回调）。
  const createGestureChain = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    const methods = [
      'minDistance',
      'runOnJS',
      'onTouchesDown',
      'onTouchesMove',
      'onTouchesUp',
      'onTouchesCancelled',
      'onFinalize',
      'onStart',
      'onUpdate',
      'onEnd',
    ];
    for (const method of methods) {
      chain[method] = () => chain;
    }
    return chain;
  };

  return {
    Gesture: {
      Pan: () => createGestureChain(),
    },
    // 透传 children，不建立手势上下文，因此永远不会触发触摸回调。
    GestureDetector: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    GestureHandlerRootView: ({
      children,
      ...rest
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement(View, rest, children),
    // 数值枚举 + 反向映射，与 RNGH 运行时形状一致（组件用 PointerType[n] 反查名字）。
    PointerType: { TOUCH: 1, MOUSE: 2, PEN: 3, 1: 'TOUCH', 2: 'MOUSE', 3: 'PEN' },
    State: {
      UNDETERMINED: 0,
      FAILED: 1,
      BEGAN: 2,
      CANCELLED: 3,
      ACTIVE: 4,
      END: 5,
    },
  };
});

// 依赖真实源码：testID 常量从被测组件导出，避免在测试里复制字符串造成漂移。
import NativeAdapterSmokeSurface, {
  NATIVE_ADAPTER_SMOKE_TEST_IDS,
} from '../../../apps/playground/src/native-adapter/NativeAdapterSmokeSurface';

describe('NativeAdapterSmokeSurface 组件挂载（RN 渲染层证据）', () => {
  it('渲染稳定的 root/interaction/status/events/reset testID', async () => {
    const result = await render(<NativeAdapterSmokeSurface />);

    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.root)).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.interaction)).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.status)).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.events)).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.reset)).toBeTruthy();
  });

  it('显示明确的 native 冒烟与限制文案，而非产品画布', async () => {
    const result = await render(<NativeAdapterSmokeSurface />);

    // native 冒烟标题与 adapter 链路说明
    expect(result.getByText('Native Input Adapter 冒烟')).toBeTruthy();
    // 已知限制明示：原生触摸不携带修饰键
    expect(result.getByText(/不携带修饰键/)).toBeTruthy();
    // 未注入真实触摸 → 事件流为空是预期，不是失败
    expect(result.getByText('尚无输入事件')).toBeTruthy();
    // 初始会话状态为 idle
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.status).props.children).toBe('idle');
  });

  it('交互区域具备可访问性语义（可访问性证据，非触摸证据）', async () => {
    const result = await render(<NativeAdapterSmokeSurface />);

    // 断言 accessibilityRole/Label 由 RNTL 按语义暴露。
    expect(result.getByLabelText('Native adapter 冒烟交互区域')).toBeTruthy();
    // 重置按钮暴露为 button 角色。
    expect(result.getByRole('button', { name: '重置会话' })).toBeTruthy();
  });

  it('可通过 RNTL 可靠触发 reset，重置后组件仍可用且状态文案更新', async () => {
    const result = await render(<NativeAdapterSmokeSurface />);

    const reset = result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.reset);

    // 初始无残留触点，第 0 代 destroy。
    await fireEvent.press(reset);
    expect(result.getByText('第 0 代已 destroy：无残留触点')).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.status).props.children).toBe('idle');

    // 再次重置：换代继续、仍可操作，证明 reset 后组件可用且状态更新。
    await fireEvent.press(reset);
    expect(result.getByText('第 1 代已 destroy：无残留触点')).toBeTruthy();
    // 交互区与事件流节点仍在（未因重置而卸载）。
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.interaction)).toBeTruthy();
    expect(result.getByTestId(NATIVE_ADAPTER_SMOKE_TEST_IDS.events)).toBeTruthy();
  });
});
