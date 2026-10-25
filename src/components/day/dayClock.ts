import { createContext, useContext } from 'react';

import type { ZonedTime } from '../../model/tripModel';

// The clock to follow a row's time with (' MST'), from the day the row is on
// (clockSuffix); DayTimeline provides it, so each row doesn't need the Day.
export const ClockSuffixContext = createContext<(time: ZonedTime) => string>(() => '');

export function useClockSuffix(time: ZonedTime | null): string {
  const suffix = useContext(ClockSuffixContext);
  return time ? suffix(time) : '';
}
