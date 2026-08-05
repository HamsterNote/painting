import { Button, Menu, MenuItem, Popover, type PopoverTheme } from '@hamster-note/components';
import { useEffect, useId, useState } from 'react';

const STROKE_COLOR_PRESETS = [
  { id: 'black', label: 'Black', value: '#000000' },
  { id: 'blue', label: 'Blue', value: '#2563eb' },
  { id: 'red', label: 'Red', value: '#dc2626' },
  { id: 'green', label: 'Green', value: '#16a34a' },
  { id: 'orange', label: 'Orange', value: '#ea580c' },
  { id: 'purple', label: 'Purple', value: '#9333ea' },
] as const;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** PaintingBoard 与 PaintingController 共用的预设颜色配置。 */
export interface PaintingColorOption {
  readonly name: string;
  readonly color: string;
}

interface PaintingStrokeColorControlProps {
  readonly strokeColor: string;
  readonly theme: PopoverTheme;
  readonly onStrokeColorChange: (strokeColor: string) => void;
  /** 预设颜色列表；若不传则使用默认预设。 */
  readonly presetColors?: readonly PaintingColorOption[];
}

export function PaintingStrokeColorControl({
  strokeColor,
  theme,
  onStrokeColorChange,
  presetColors,
}: PaintingStrokeColorControlProps) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const normalizedStrokeColor = strokeColor.toLowerCase();
  const customInputColor = HEX_COLOR_PATTERN.test(strokeColor) ? strokeColor : '#000000';

  const mergedPresets =
    presetColors ?? STROKE_COLOR_PRESETS.map((p) => ({ color: p.value, name: p.label }));

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuAnchor?.contains(target)) return;
      if (target.closest('[data-testid="painting-board-stroke-color-menu"]')) return;
      setMenuOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown, true);
  }, [menuAnchor, menuOpen]);

  return (
    <>
      <Button
        type="button"
        size="small"
        variant="ghost"
        data-testid="painting-board-stroke-color-btn"
        data-color={strokeColor}
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Stroke color: ${strokeColor}`}
        style={{ justifyContent: 'center' }}
        onClick={(event) => {
          setMenuAnchor(event.currentTarget);
          setMenuOpen((open) => !open);
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: strokeColor,
            border: '2px solid rgba(255, 255, 255, 0.82)',
            boxShadow: '0 0 0 1px rgba(9, 9, 11, 0.45)',
          }}
        />
      </Button>
      {menuOpen && menuAnchor ? (
        <Popover
          id={menuId}
          anchor={menuAnchor}
          placement="top-start"
          theme={theme}
          data-testid="painting-board-stroke-color-menu"
        >
          <Menu aria-label="Stroke color" style={{ minWidth: 156 }}>
            {mergedPresets.map((preset, index) => {
              const selected = preset.color === normalizedStrokeColor;
              return (
                <MenuItem
                  key={`${preset.color}-${preset.name}`}
                  data-testid={`painting-board-stroke-color-preset-${index}`}
                  aria-current={selected ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    ...(selected ? { background: 'var(--hn-color-accent)', color: '#09090b' } : {}),
                  }}
                  onClick={() => {
                    onStrokeColorChange(preset.color);
                    setMenuOpen(false);
                  }}
                >
                  <span
                    aria-hidden="true"
                    data-testid={`painting-board-stroke-color-preset-${index}-swatch`}
                    style={{
                      display: 'inline-block',
                      width: 20,
                      height: 20,
                      marginRight: 10,
                      verticalAlign: 'middle',
                      boxSizing: 'border-box',
                      borderRadius: '50%',
                      background: preset.color,
                      border: '2px solid rgba(255, 255, 255, 0.82)',
                      boxShadow: '0 0 0 1px rgba(9, 9, 11, 0.35)',
                    }}
                  />
                  {preset.name}
                </MenuItem>
              );
            })}
            <label
              style={{
                minHeight: 36,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span
                data-testid="painting-board-stroke-color-custom-swatch"
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: 20,
                  height: 20,
                  flex: '0 0 20px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  borderRadius: '50%',
                  background: customInputColor,
                  border: '2px solid rgba(255, 255, 255, 0.82)',
                  boxShadow: '0 0 0 1px rgba(9, 9, 11, 0.35)',
                }}
              >
                <input
                  type="color"
                  value={customInputColor}
                  data-testid="painting-board-stroke-color-custom-input"
                  aria-label="Custom stroke color"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    padding: 0,
                    border: 0,
                    opacity: 0,
                    cursor: 'pointer',
                  }}
                  onChange={(event) => {
                    onStrokeColorChange(event.currentTarget.value);
                  }}
                />
              </span>
              Custom
            </label>
          </Menu>
        </Popover>
      ) : null}
    </>
  );
}
