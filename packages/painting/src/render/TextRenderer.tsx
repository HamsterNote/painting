import type { ReactElement } from 'react';
import { textBoxFromPoints } from '../model/text';

type TextRenderable = {
  readonly id: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly text?: string;
  readonly fontSize?: number;
  readonly strokeColor?: string;
  readonly rotationRad?: number;
};

export type TextRendererProps = {
  readonly stroke: TextRenderable;
  readonly fallbackColor: string;
  readonly fallbackFontSize: number;
};

export function TextRenderer({
  stroke,
  fallbackColor,
  fallbackFontSize,
}: TextRendererProps): ReactElement | null {
  const box = textBoxFromPoints(stroke.points);
  if (box === null || box.width <= 0 || box.height <= 0 || !stroke.text) {
    return null;
  }

  const rotationRad = stroke.rotationRad;
  const transform =
    typeof rotationRad === 'number' && Number.isFinite(rotationRad) && rotationRad !== 0
      ? `rotate(${(rotationRad * 180) / Math.PI} ${box.x + box.width / 2} ${box.y + box.height / 2})`
      : undefined;

  return (
    <foreignObject
      data-text-stroke-id={stroke.id}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      transform={transform}
      pointerEvents="none"
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          color: stroke.strokeColor ?? fallbackColor,
          fontSize: stroke.fontSize ?? fallbackFontSize,
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {stroke.text}
      </div>
    </foreignObject>
  );
}
