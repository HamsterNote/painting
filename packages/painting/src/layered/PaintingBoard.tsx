import type { LayeredDrawingSurfaceProps } from './DrawingSurface';
import { LayeredDrawingSurface } from './DrawingSurface';
import { Toolbar } from './Toolbar';

export type LayeredPaintingBoardProps = LayeredDrawingSurfaceProps & { toolbar?: boolean };

export function LayeredPaintingBoard({ toolbar = true, ...props }: LayeredPaintingBoardProps) {
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
      {toolbar ? <Toolbar controller={props.controller} placement="floating" /> : null}
    </div>
  );
}
