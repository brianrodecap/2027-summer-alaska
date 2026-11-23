import type { DayKind } from './dayKind';
import { wholeDays } from './moveToDay';

// The words on a day's poster, from the day alone.

export interface PosterCaption {
  number: string; // the day of the month: "29"
  dayLine: string; // "Tue · June · Day 4"
}

const utcParts = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

// `tripStart` is the trip's first date, which makes `date` its Day 1, 2, ...; a date
// before the start has no day number.
export function posterCaption(date: string, tripStart: string | null): PosterCaption {
  const weekday = utcParts(date, { weekday: 'short' });
  const month = utcParts(date, { month: 'long' });
  const dayOfTrip = tripStart === null ? 0 : wholeDays(tripStart, date) + 1;
  return {
    number: String(Number(date.slice(8, 10))),
    dayLine: [weekday, month, ...(dayOfTrip >= 1 ? [`Day ${dayOfTrip}`] : [])].join(' · '),
  };
}

const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

// How many plans a day offers: the tabs of its largest group, since the day's tabs
// are every group's together.
export function planCount(tracks: { groupKey: string }[]): number {
  const perGroup = new Map<string, number>();
  for (const { groupKey } of tracks) perGroup.set(groupKey, (perGroup.get(groupKey) ?? 0) + 1);
  return Math.max(0, ...perGroup.values());
}

// The stamp naming the kind of day; none for a day spent staying put.
export function kindStamp(kind: DayKind, plans: number): string | null {
  switch (kind) {
    case 'drive':
      return 'Drive day';
    case 'flight':
      return 'Flight day';
    case 'port':
      return 'In port';
    case 'sea':
      return 'At sea';
    case 'scenario':
      return `${COUNT_WORDS[plans] ?? plans} ${plans === 1 ? 'plan' : 'plans'}`;
    case 'stay':
      return null;
  }
}
