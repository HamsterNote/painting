import { generateRulerTicks, type RulerTickKind } from './ticks';

export type RulerTicksProps = {
  readonly length: number;
  readonly height: number;
  readonly pixelsPerInch?: number;
  readonly originX?: number;
};

const TICK_HEIGHT_BY_KIND: Readonly<Record<RulerTickKind, number>> = {
  millimeter: 6,
  'half-centimeter': 10,
  centimeter: 14,
};

export function RulerTicks({ length, height, pixelsPerInch, originX }: RulerTicksProps) {
  const ticks = generateRulerTicks({ length, pixelsPerInch, originX });
  const top = -height / 2;
  const bottom = height / 2;

  return (
    <g data-testid="drawing-ruler-ticks" pointerEvents="none" style={{ userSelect: 'none' }}>
      {ticks.map((tick) => {
        const tickHeight = Math.min(TICK_HEIGHT_BY_KIND[tick.kind], height);
        return [
          <line
            key={`${tick.millimeter}-top`}
            data-ruler-tick-kind={tick.kind}
            data-ruler-tick-side="top"
            x1={tick.localX}
            y1={top}
            x2={tick.localX}
            y2={top + tickHeight}
            stroke="currentColor"
            strokeWidth={1}
          />,
          <line
            key={`${tick.millimeter}-bottom`}
            data-ruler-tick-kind={tick.kind}
            data-ruler-tick-side="bottom"
            x1={tick.localX}
            y1={bottom}
            x2={tick.localX}
            y2={bottom - tickHeight}
            stroke="currentColor"
            strokeWidth={1}
          />,
        ];
      })}
    </g>
  );
}
