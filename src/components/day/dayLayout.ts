import type { Theme } from '@mui/material/styles';

import { STOP_NODE_SIZE } from '../shared/StopRail';

// Layout facts the day list's pieces must agree on, kept in one place so
// they can't drift apart: DaysView's sticky app bar, DayAccordion's sticky
// day headers (which sit directly under it) and the scroll-into-view landing
// for "jump to a day", and the DOM id every consumer uses to find a day's
// block.

export const DAYS_APP_BAR_HEIGHT = '4rem';

// Breathing room between the app bar and a day block scrolled into view.
export const DAY_SCROLL_GAP = '0.5rem';

export const dayElementId = (date: string): string => `day-${date}`;

// The wide layout's side panes (the day navigator, the map or assistant): they
// stay in view at full height while the day list scrolls.
export const STICKY_PANE_SX = {
  flexShrink: 0,
  position: 'sticky',
  top: 0,
  height: '100vh',
} as const;

// The day list's width in the wide layout; the map or assistant takes the rest.
export const DAY_LIST_WIDTH = { lg: 540, xl: 620 } as const;

// The drag handle's icon button, a small 20px icon and its padding; every timeline
// row keeps a gutter this wide for it, so the cards line up.
export const DRAG_HANDLE_ICON_SIZE = 20;
export const DRAG_HANDLE_PADDING_PX = 2;
export const DRAG_HANDLE_WIDTH = DRAG_HANDLE_ICON_SIZE + DRAG_HANDLE_PADDING_PX * 2;

// From a row's line column to its card (theme spacing).
export const TIMELINE_CONTENT_PAD = 1;

// A section's content starts half a dot column plus the pad right of its line. Its
// nested plan's list is pulled left by that much, less a clearance that keeps the
// list's drag handles off the line. A CSS length.
const LINE_CLEARANCE_PX = 5;
export const nestedPull = (theme: Theme) =>
  `calc(${STOP_NODE_SIZE / 2 - LINE_CLEARANCE_PX}px + ${theme.spacing(TIMELINE_CONTENT_PAD)})`;
