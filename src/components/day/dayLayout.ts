// Layout facts the day list's pieces must agree on, kept in one place so
// they can't drift apart: DaysView's sticky app bar, DayAccordion's sticky
// day headers (which sit directly under it) and the scroll-into-view landing
// for "jump to a day", and the DOM id every consumer uses to find a day's
// block.

export const DAYS_APP_BAR_HEIGHT = '4rem';

// Breathing room between the app bar and a day block scrolled into view.
export const DAY_SCROLL_GAP = '0.5rem';

export const dayElementId = (date: string): string => `day-${date}`;
