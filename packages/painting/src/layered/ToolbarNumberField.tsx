import { useEffect, useState, type CSSProperties } from 'react';

/** Keep incomplete typing (e.g. "1" on the way to 125%) out of the controller. */
export function ToolbarNumberField({
  label,
  value,
  min,
  max,
  step,
  style,
  apply,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  style?: CSSProperties;
  /** Returns the authoritative value, including when the controller refuses the change. */
  apply: (value: number) => number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      style={{
        ...style,
        userSelect: 'text',
        WebkitUserSelect: 'text',
        WebkitTouchCallout: 'default',
      }}
      value={draft}
      onChange={(event) => {
        const text = event.currentTarget.value;
        const number = event.currentTarget.valueAsNumber;
        if (Number.isFinite(number) && number >= min && number <= max)
          setDraft(String(apply(number)));
        else setDraft(text);
      }}
      onBlur={() => setDraft(String(value))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const number = event.currentTarget.valueAsNumber;
        setDraft(
          String(Number.isFinite(number) && number >= min && number <= max ? apply(number) : value)
        );
      }}
    />
  );
}
