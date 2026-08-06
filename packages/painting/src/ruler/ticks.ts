export const DEFAULT_RULER_PIXELS_PER_INCH = 96;

export type RulerTickKind = 'millimeter' | 'half-centimeter' | 'centimeter';

export type RulerTick = {
  readonly localX: number;
  readonly millimeter: number;
  readonly kind: RulerTickKind;
};

export type GenerateRulerTicksOptions = {
  readonly length: number;
  readonly pixelsPerInch?: number;
  readonly originX?: number;
};

const MILLIMETERS_PER_INCH = 25.4;
const MAX_RULER_TICKS = 2_000;

function resolvePixelsPerInch(pixelsPerInch: number | undefined): number {
  return typeof pixelsPerInch === 'number' && Number.isFinite(pixelsPerInch) && pixelsPerInch > 0
    ? pixelsPerInch
    : DEFAULT_RULER_PIXELS_PER_INCH;
}

export function millimetersToPixels(
  millimeters: number,
  pixelsPerInch = DEFAULT_RULER_PIXELS_PER_INCH
): number {
  return (millimeters * resolvePixelsPerInch(pixelsPerInch)) / MILLIMETERS_PER_INCH;
}

export function generateRulerTicks(options: GenerateRulerTicksOptions): readonly RulerTick[] {
  const length = Number.isFinite(options.length) && options.length > 0 ? options.length : 0;
  const millimeterSpacing = millimetersToPixels(1, options.pixelsPerInch);
  const originX =
    typeof options.originX === 'number' && Number.isFinite(options.originX)
      ? options.originX
      : -length / 2;
  const firstMillimeter = Math.ceil((-length / 2 - originX) / millimeterSpacing);
  const lastMillimeter = Math.floor((length / 2 - originX) / millimeterSpacing);
  const visibleTickCount = Math.max(lastMillimeter - firstMillimeter + 1, 0);
  const tickCount = Math.min(visibleTickCount, MAX_RULER_TICKS);
  const centeredFirstMillimeter = Math.round(-originX / millimeterSpacing - (tickCount - 1) / 2);
  const renderedFirstMillimeter = Math.max(
    firstMillimeter,
    Math.min(centeredFirstMillimeter, lastMillimeter - tickCount + 1)
  );

  return Array.from({ length: tickCount }, (_, index) => {
    const millimeter = renderedFirstMillimeter + index;
    const absoluteMillimeter = Math.abs(millimeter);
    const kind: RulerTickKind =
      absoluteMillimeter % 10 === 0
        ? 'centimeter'
        : absoluteMillimeter % 5 === 0
          ? 'half-centimeter'
          : 'millimeter';

    return {
      localX: originX + millimeter * millimeterSpacing,
      millimeter,
      kind,
    };
  });
}
