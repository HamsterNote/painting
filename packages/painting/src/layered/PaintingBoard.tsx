import type { LayeredDrawingSurfaceProps } from './DrawingSurface';
import { LayeredDrawingSurface } from './DrawingSurface';
import { Toolbar } from './Toolbar';

export type LayeredPaintingBoardProps = LayeredDrawingSurfaceProps & { toolbar?: boolean };

export function LayeredPaintingBoard({ toolbar = true, ...props }: LayeredPaintingBoardProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {toolbar ? <Toolbar controller={props.controller} /> : null}
      <LayeredDrawingSurface {...props} />
    </div>
  );
}
