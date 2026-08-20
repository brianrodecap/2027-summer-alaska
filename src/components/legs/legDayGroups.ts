import type { Day } from '../../model/types';

export interface LocationDayGroup {
  location: string;
  days: Day[];
}

// Days are grouped by contiguous same-location runs so a multi-day Stay
// (e.g. all 7 cruise days sharing one lodging name) collapses into one
// disclosure instead of repeating that name as every row's headline — the
// row headline uses the day's own summary (first activity, or "Staying at
// X") so days within a run still read as distinct from one another.
export function groupDaysByLocation(days: Day[]): LocationDayGroup[] {
  const groups: LocationDayGroup[] = [];
  for (const day of days) {
    const last = groups[groups.length - 1];
    if (last && last.location === day.location) last.days.push(day);
    else groups.push({ location: day.location, days: [day] });
  }
  return groups;
}
