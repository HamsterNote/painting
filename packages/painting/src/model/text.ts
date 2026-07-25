export const DEFAULT_TEXT_FONT_SIZE = 24;
export const DEFAULT_TEXT_BOX_WIDTH = 160;
export const MIN_TEXT_BOX_WIDTH = 24;
export const TEXT_LINE_HEIGHT = 1.2;

export type TextBoxPoint = Readonly<{
  x: number;
  y: number;
}>;

export type TextBox = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export function resolveTextFontSize(fontSize: number | undefined): number {
  return typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_TEXT_FONT_SIZE;
}

export function textBoxFromPoints(points: readonly TextBoxPoint[]): TextBox | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return null;
  }

  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width: Math.abs(last.x - first.x),
    height: Math.abs(last.y - first.y),
  };
}

export function createTextBoxPoints(
  origin: TextBoxPoint,
  fontSize: number
): [TextBoxPoint, TextBoxPoint] {
  const resolvedFontSize = resolveTextFontSize(fontSize);
  return [
    { x: origin.x, y: origin.y },
    {
      x: origin.x + DEFAULT_TEXT_BOX_WIDTH,
      y: origin.y + resolvedFontSize * TEXT_LINE_HEIGHT,
    },
  ];
}

export function resolveTextBoxHeight(
  text: string,
  fontSize: number,
  width: number,
  measuredHeight = 0
): number {
  const resolvedFontSize = resolveTextFontSize(fontSize);
  const availableWidth = Math.max(MIN_TEXT_BOX_WIDTH, width);
  const lineCount = Math.max(
    1,
    text.split('\n').reduce((total, line) => {
      const estimatedWidth = Array.from(line).reduce(
        (sum, character) =>
          sum + ((character.codePointAt(0) ?? 0) <= 0xff ? 0.6 : 1) * resolvedFontSize,
        0
      );
      return total + Math.max(1, Math.ceil(estimatedWidth / availableWidth));
    }, 0)
  );
  return Math.max(
    lineCount * resolvedFontSize * TEXT_LINE_HEIGHT,
    measuredHeight
  );
}

export function resizeTextBoxHeight(
  points: readonly TextBoxPoint[],
  height: number
): TextBoxPoint[] {
  if (points.length < 2) {
    return [...points];
  }
  const first = points[0];
  return points.map((point, index) =>
    index === points.length - 1
      ? {
          ...point,
          y: first.y <= point.y ? first.y + height : first.y - height,
        }
      : point
  );
}
