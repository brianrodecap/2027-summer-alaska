import { type MouseEvent, useState } from 'react';

// Shared open/close wiring for an icon-button-triggered MUI Menu — see
// RowMenu and DayBlock's AddDayNoteButton, the app's two kebab-style menu
// triggers. `pick` wraps a menu item's action with the same
// stopPropagation-then-close sequence every item needs, so a click aimed at
// the menu never also fires whatever onClick the row itself carries.
export function useAnchorMenu() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const openAt = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const close = () => setAnchorEl(null);
  const pick = (action: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    action();
    close();
  };

  return { anchorEl, openAt, close, pick };
}
