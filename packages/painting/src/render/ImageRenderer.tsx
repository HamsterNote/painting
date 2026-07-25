import type { ReactElement } from 'react';
import type { DrawingPointV2 } from '../model/strokes';

export type ImageRendererProps = {
  readonly id: string;
  readonly points: readonly DrawingPointV2[];
  readonly src: string | undefined;
  readonly rotationRad?: number;
  readonly opacity?: '0.7';
};

export function ImageRenderer({
  id,
  points,
  src,
  rotationRad,
  opacity,
}: ImageRendererProps): ReactElement | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || !src) {
    return null;
  }

  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  const rotation =
    typeof rotationRad === 'number' && Number.isFinite(rotationRad) && rotationRad !== 0
      ? `rotate(${(rotationRad * 180) / Math.PI} ${x + width / 2} ${y + height / 2})`
      : undefined;

  return (
    <image
      data-image-stroke-id={id}
      href={src}
      x={x}
      y={y}
      width={width}
      height={height}
      preserveAspectRatio="none"
      transform={rotation}
      opacity={opacity}
      pointerEvents="none"
    />
  );
}
