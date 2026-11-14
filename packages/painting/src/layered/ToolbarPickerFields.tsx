import { useId, useState } from 'react';

/** WKWebView can open a native picker merely from select.focus(). */
export function ToolbarChoiceField({
  label,
  ariaLabel = label,
  inline,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  inline: boolean;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const name = useId();
  if (!inline)
    return (
      <label>
        <span>{label}</span>
        <select
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <fieldset className="hn-painting-choices" aria-label={ariaLabel}>
      <legend>
        <span>{label}</span>
      </legend>
      {options.map(([option, text]) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {text}
        </label>
      ))}
    </fieldset>
  );
}

/** An ordinary text editor keeps the keyboard in WebKit, without a color sheet. */
export function ToolbarHexColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const valid = /^#[\da-f]{6}$/i.test(text);
  return (
    <input
      className="hn-painting-hex-color"
      type="text"
      data-toolbar-color-field="true"
      aria-label="自定义颜色值"
      aria-invalid={!valid}
      placeholder="#RRGGBB"
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="none"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (/^#[\da-f]{6}$/i.test(next)) onChange(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
