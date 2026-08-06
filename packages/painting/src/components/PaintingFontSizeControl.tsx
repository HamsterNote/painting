import { Button, Menu, MenuItem, Popover, type PopoverTheme } from '@hamster-note/components';
import { useEffect, useId, useState } from 'react';

const FONT_SIZE_OPTIONS = [12, 16, 20, 24, 32, 48] as const;

interface PaintingFontSizeControlProps {
  readonly fontSize: number;
  readonly theme: PopoverTheme;
  readonly onFontSizeChange: (fontSize: number) => void;
}

export function PaintingFontSizeControl({
  fontSize,
  theme,
  onFontSizeChange,
}: PaintingFontSizeControlProps) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuAnchor?.contains(target)) return;
      if (target.closest('[data-testid="painting-board-font-size-menu"]')) return;
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
        data-testid="painting-board-font-size-btn"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Font size: ${fontSize} px`}
        onClick={(event) => {
          setMenuAnchor(event.currentTarget);
          setMenuOpen((open) => !open);
        }}
      >
        {fontSize} px
      </Button>
      {menuOpen && menuAnchor ? (
        <Popover
          id={menuId}
          anchor={menuAnchor}
          placement="top-start"
          theme={theme}
          data-testid="painting-board-font-size-menu"
        >
          <Menu aria-label="Font size">
            {FONT_SIZE_OPTIONS.map((option) => (
              <MenuItem
                key={option}
                data-testid={`painting-board-font-size-${option}`}
                aria-current={option === fontSize ? 'true' : undefined}
                style={
                  option === fontSize
                    ? { background: 'var(--hn-color-accent)', color: '#09090b' }
                    : undefined
                }
                onClick={() => {
                  onFontSizeChange(option);
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
