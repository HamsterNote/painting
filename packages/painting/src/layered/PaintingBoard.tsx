import type { ToolbarFileNavigationProps, PaneToolbarLayout } from '../toolbar';
import type { LayeredDrawingSurfaceProps } from './DrawingSurface';
import { LayeredDrawingSurface } from './DrawingSurface';
import { Toolbar } from './Toolbar';

export type LayeredPaintingBoardProps = LayeredDrawingSurfaceProps &
  ToolbarFileNavigationProps & {
    layout?: PaneToolbarLayout;
    toolbar?: boolean;
    /** Keep keyboard focus in the page on hosts that open native pickers on focus. */
    toolbarInlinePickers?: boolean;
  };

export function LayeredPaintingBoard({
  toolbar = true,
  toolbarInlinePickers = false,
  files,
  currentFileKey,
  paneId,
  busy,
  onSelectFile,
  onRequestRemove,
  layout,
  ...props
}: LayeredPaintingBoardProps) {
  return (
    <div
      data-painting-board="true"
      data-pane-toolbar-boundary="true"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
        isolation: 'isolate',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <LayeredDrawingSurface {...props} />
      </div>
      {toolbar ? (
        <Toolbar
          controller={props.controller}
          files={files}
          currentFileKey={currentFileKey}
          paneId={paneId}
          busy={busy}
          onSelectFile={onSelectFile}
          onRequestRemove={onRequestRemove}
          layout={layout}
          placement="floating"
          inlinePickers={toolbarInlinePickers}
        />
      ) : null}
    </div>
  );
}
