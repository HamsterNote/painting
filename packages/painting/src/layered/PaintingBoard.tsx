import type { LayeredDrawingSurfaceProps } from './DrawingSurface';
import { LayeredDrawingSurface } from './DrawingSurface';
import { Toolbar } from './Toolbar';

export type LayeredPaintingBoardProps = LayeredDrawingSurfaceProps & {
  toolbar?: boolean;
  /** Keep keyboard focus in the page on hosts that open native pickers on focus. */
  toolbarInlinePickers?: boolean;
};

export function LayeredPaintingBoard({
  toolbar = true,
  toolbarInlinePickers = false,
  ...props
}: LayeredPaintingBoardProps) {
  return (
    <div
      data-painting-board="true"
      style={{
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
      <LayeredDrawingSurface {...props} />
      {toolbar ? (
        <Toolbar
          controller={props.controller}
          placement="floating"
          inlinePickers={toolbarInlinePickers}
        />
      ) : null}
    </div>
  );
}
