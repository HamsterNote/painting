import {
  type InteractionFeedbackPoint,
  TOUCH_ZOOM_FEEDBACK_HEIGHT,
  TOUCH_ZOOM_FEEDBACK_WIDTH,
} from '../interactionFeedback';

type InteractionFeedbackProps = {
  readonly label: string;
  readonly point: InteractionFeedbackPoint;
  readonly source: 'mouse' | 'touch';
};

export function InteractionFeedback({ label, point, source }: InteractionFeedbackProps) {
  return (
    <div
      data-testid="drawing-zoom-feedback"
      data-feedback-source={source}
      data-feedback-x={point.x}
      data-feedback-y={point.y}
      style={{
        position: 'absolute',
        left: point.x,
        top: point.y,
        zIndex: 20,
        width: source === 'touch' ? TOUCH_ZOOM_FEEDBACK_WIDTH : undefined,
        minWidth: source === 'mouse' ? 48 : undefined,
        height: TOUCH_ZOOM_FEEDBACK_HEIGHT,
        padding: '0 10px',
        borderRadius: 999,
        background: 'white',
        color: 'black',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
        pointerEvents: 'none',
        userSelect: 'none',
        transform: 'translate(-50%, -50%)',
      }}
    >
      {label}
    </div>
  );
}
