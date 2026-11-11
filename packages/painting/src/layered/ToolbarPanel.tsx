import type { ComponentProps } from 'react';
import { ToolbarPopover } from '../toolbar/ToolbarPopover';

export function ToolbarPanel(props: ComponentProps<typeof ToolbarPopover>) {
  return <ToolbarPopover {...props} className="hn-painting-toolbar hn-painting-panel" />;
}
