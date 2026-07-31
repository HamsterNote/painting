export type InteractionFeedbackPoint = {
  readonly x: number;
  readonly y: number;
};

const MOUSE_FEEDBACK_OFFSET = 28;
const MOUSE_FEEDBACK_HALF_HEIGHT = 16;
const TOUCH_FEEDBACK_UPPER_OFFSET = 36;

export const TOUCH_ZOOM_FEEDBACK_WIDTH = 64;
export const TOUCH_ZOOM_FEEDBACK_HEIGHT = 32;

export type InteractionFeedbackViewport = {
  readonly width: number;
  readonly height: number;
};

export function formatScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function formatAngleDegrees(rotationRad: number): string {
  return `${Math.round((rotationRad * 180) / Math.PI)}°`;
}

export function getMouseZoomFeedbackPoint(
  pointer: InteractionFeedbackPoint
): InteractionFeedbackPoint {
  const upperCenterY = pointer.y - MOUSE_FEEDBACK_OFFSET;
  return {
    x: pointer.x,
    y:
      upperCenterY - MOUSE_FEEDBACK_HALF_HEIGHT >= 0
        ? upperCenterY
        : pointer.y + MOUSE_FEEDBACK_OFFSET,
  };
}

export function getTouchZoomFeedbackPoint(
  first: InteractionFeedbackPoint,
  second: InteractionFeedbackPoint,
  viewport: InteractionFeedbackViewport
): InteractionFeedbackPoint {
  const midpoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
  const distanceClamped = {
    x: midpoint.x,
    y: midpoint.y - TOUCH_FEEDBACK_UPPER_OFFSET,
  };
  const touchFeedbackHalfWidth = TOUCH_ZOOM_FEEDBACK_WIDTH / 2;
  const touchFeedbackHalfHeight = TOUCH_ZOOM_FEEDBACK_HEIGHT / 2;
  const minX = Math.min(touchFeedbackHalfWidth, viewport.width / 2);
  const maxX = Math.max(minX, viewport.width - touchFeedbackHalfWidth);
  const minY = Math.min(touchFeedbackHalfHeight, viewport.height / 2);
  const maxY = Math.max(minY, viewport.height - touchFeedbackHalfHeight);
  return {
    x: Math.min(maxX, Math.max(minX, distanceClamped.x)),
    y: Math.min(maxY, Math.max(minY, distanceClamped.y)),
  };
}
