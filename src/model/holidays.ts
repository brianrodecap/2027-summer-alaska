// Live US public-holiday lookup via Nager.Date (date.nager.at/api/v3) — free,
// keyless, CORS-enabled REST API returning a whole year's public holidays in
// one call. Same "computed at render time, never written back into the
// trip's own JSON" approach as weather.ts: this is refetched (or served from
// a persisted cache) fresh as of whenever the site happens to be opened,
// rather than baked in as of whenever this code shipped.
import { memoizeAsync, persisted } from './asyncCache';

export interface Holiday {
  date: string; // ISO yyyy-mm-dd
  name: string;
}

interface NagerHoliday {
  date: string;
  name: string;
  global: boolean;
  types: string[];
}

// Versions this file's own persisted cache entries — bump if the shape ever
// changes, so a stale cached entry from before the change isn't misread.
const CACHE_VERSION = 1;
// A year's public holidays never change once the year has passed, and rarely
// change even for the current/next year — 30 days matches weather.ts's own
// climate-average TTL for the same "cheap to refresh occasionally, no need
// to hit the network every visit" reasoning.
const HOLIDAY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// US federal holidays that land on a fixed calendar month/day (as opposed to
// e.g. Thanksgiving's "4th Thursday of November", which never needs this).
// When one of these falls on a Saturday/Sunday, Nager.Date's
// PublicHolidays response only reports the shifted, government-observed
// non-working day (confirmed against its own API: 2027's Independence Day
// entry comes back dated 2027-07-05, never 07-04) — it has no field for the
// original date. withFixedDateSplits below fills that gap by also emitting
// the true calendar date as its own entry whenever it differs from the
// observed one.
const FIXED_DATE_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 6, day: 19, name: 'Juneteenth National Independence Day' },
  { month: 7, day: 4, name: 'Independence Day' },
  { month: 11, day: 11, name: 'Veterans Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
];

function fixedHolidayDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function withFixedDateSplits(year: number, holidays: Holiday[]): Holiday[] {
  return holidays.flatMap((h) => {
    const fixed = FIXED_DATE_HOLIDAYS.find((f) => f.name === h.name);
    if (!fixed) return [h];
    const actualDate = fixedHolidayDate(year, fixed.month, fixed.day);
    if (actualDate === h.date) return [h];
    return [
      { date: h.date, name: `${h.name} (observed)` },
      { date: actualDate, name: h.name },
    ];
  });
}

const yearCache = new Map<string, Promise<Holiday[]>>();

async function fetchYearHolidays(year: number, countryCode: string): Promise<Holiday[]> {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
  if (!res.ok) throw new Error(`Nager.Date error ${res.status}`);
  const json = (await res.json()) as NagerHoliday[];
  // Nager.Date's `types` can also carry "Bank"/"School"/"Optional"/
  // "Observance" entries (e.g. Groundhog Day) alongside real public
  // holidays — "Public" is the one that actually means "day off" here.
  const publicHolidays = json
    .filter((h) => h.types.includes('Public'))
    .map((h) => ({ date: h.date, name: h.name }));
  return withFixedDateSplits(year, publicHolidays);
}

function getYearHolidays(year: number, countryCode: string): Promise<Holiday[]> {
  const key = `${countryCode}:${year}`;
  const storageKey = `holidays:v${CACHE_VERSION}:${key}`;
  return memoizeAsync(yearCache, key, () =>
    persisted(storageKey, HOLIDAY_CACHE_TTL_MS, () => fetchYearHolidays(year, countryCode)),
  );
}

// Looks up whether `date` (an ISO yyyy-mm-dd string, per this codebase's
// plain-string date convention — see tripModel.ts's top-of-file note) is a
// US public holiday. Resolves to null on any lookup failure (offline, rate
// limited, etc.) — this is a nice-to-have flag, not something worth
// surfacing an error state for.
export async function getHoliday(date: string, countryCode = 'US'): Promise<Holiday | null> {
  const year = Number(date.slice(0, 4));
  const holidays = await getYearHolidays(year, countryCode).catch(() => []);
  return holidays.find((h) => h.date === date) ?? null;
}
