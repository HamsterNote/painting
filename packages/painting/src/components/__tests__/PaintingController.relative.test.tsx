import { render } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { PaintingController } from '../PaintingController';

interface MockPopoverProps {
  readonly children?: ReactNode;
  readonly relative?: boolean;
  readonly style?: CSSProperties;
  readonly 'data-testid'?: string;
}

const mockPopover = jest.fn(
  ({ children, style, 'data-testid': testId }: MockPopoverProps) => (
    <div data-testid={testId} style={{ position: 'fixed', ...style }}>
      {children}
    </div>
  )
);

jest.mock('@hamster-note/components', () => ({
  ...jest.requireActual('@hamster-note/components'),
  Popover: (props: MockPopoverProps) => mockPopover(props),
}));

describe('PaintingController relative positioning', () => {
  beforeEach(() => {
    mockPopover.mockClear();
  });

  it('does not pass false to Popover when relative mode is disabled', () => {
    // Given / When: 调用方不启用相对定位，控制栏使用默认 fixed 模式。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
      />
    );

    // Then: 不把 false 交给可能透传未知属性的旧版 Popover。
    const toolbarProps = mockPopover.mock.calls
      .map(([props]) => props)
      .find((props) => props['data-testid'] === 'painting-board-toolbar');
    if (!toolbarProps) throw new Error('Painting toolbar Popover was not rendered');
    expect(toolbarProps.relative).toBeUndefined();
  });

  it('positions a relative toolbar without forwarding relative to a legacy Popover', () => {
    // Given / When: 旧版 Popover 不消费 relative，只接受最终定位样式。
    render(
      <PaintingController
        data={{ tool: 'pen', minimap: false }}
        onDataChange={jest.fn()}
        tools={['pen']}
        relative
      />
    );

    // Then: PaintingController 自己提供 absolute 样式，且不把未知属性交给旧版组件。
    const toolbarProps = mockPopover.mock.calls
      .map(([props]) => props)
      .find((props) => props['data-testid'] === 'painting-board-toolbar');
    if (!toolbarProps) throw new Error('Painting toolbar Popover was not rendered');
    expect(toolbarProps.relative).toBeUndefined();
    expect(toolbarProps.style?.position).toBe('absolute');
  });
});
