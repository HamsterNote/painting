import { Button, Menu, MenuItem, Popover, type PopoverTheme } from '@hamster-note/components';
import { useEffect, useId, useState } from 'react';

const STROKE_WIDTH_OPTIONS = [1, 2, 4, 8, 12] as const;

interface PaintingStrokeWidthControlProps {
  readonly strokeWidth: number;
  readonly theme: PopoverTheme;
  readonly onStrokeWidthChange: (strokeWidth: number) => void;
}

/** 菜单经 Portal 渲染，document 捕获外部点击时需显式豁免菜单本身。 */
export function PaintingStrokeWidthControl({
  strokeWidth,
  theme,
  onStrokeWidthChange,
}: PaintingStrokeWidthControlProps) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuAnchor?.contains(target)) return;
      if (target.closest('[data-testid="painting-board-stroke-width-menu"]')) return;
      setMenuOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => document.removeEventListener('mousedown', handleOutsideClick, true);
  }, [menuAnchor, menuOpen]);

  return (
    <>
      <Button
        type="button"
        size="small"
        variant="ghost"
        data-testid="painting-board-stroke-width-btn"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Stroke width: ${strokeWidth} px`}
        onClick={(event) => {
          setMenuAnchor(event.currentTarget);
          setMenuOpen((open) => !open);
        }}
      >
        {strokeWidth} px
      </Button>
      {menuOpen && menuAnchor ? (
        <Popover
          id={menuId}
          anchor={menuAnchor}
          placement="top-start"
          theme={theme}
          data-testid="painting-board-stroke-width-menu"
        >
          <Menu aria-label="Stroke width">
            {STROKE_WIDTH_OPTIONS.map((option) => (
              <MenuItem
                key={option}
                data-testid={`painting-board-stroke-width-${option}`}
                aria-current={option === strokeWidth ? 'true' : undefined}
                style={
                  option === strokeWidth
                    ? { background: 'var(--hn-color-accent)', color: '#09090b' }
                    : undefined
                }
                onClick={() => {
                  onStrokeWidthChange(option);
                  setMenuOpen(false);
                }}
              >
                {option} px
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      ) : null}
    </>
  );
}
