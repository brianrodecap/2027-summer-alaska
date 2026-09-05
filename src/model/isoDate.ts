import { wallClockMs } from './tripModel';

// Parses an ISO 'YYYY-MM-DD' date-only string into a UTC epoch-millisecond
// timestamp — a thin midnight-time wrapper over tripModel's own
// timezone-safe wallClockMs, so a viewer's own timezone can't shift which
// calendar day this resolves to. Shared by weather.ts (day-offset lookups)
// and moonPhase.ts (synodic-cycle math) — both need this same epoch
// conversion but are otherwise independent of each other.
export function parseIsoDateUTC(date: string): number {
  return wallClockMs(`${date}T00:00`);
}

// Parses a year-less 'MM-DD' string against an arbitrary shared reference
// year, so two MM-DD values can be compared/subtracted as UTC epoch
// milliseconds regardless of which real years they were each observed in —
// e.g. weather.ts's averageForMonthDay measuring how close two climate
// samples' calendar dates are, wrap-around-year-end included. Callers doing
// that wrap-around comparison should pass the same non-leap `referenceYear`
// (2001 is a common non-leap choice) to every call so Feb 29 in one MM-DD
// value can't skew the diff against a Feb 28 in another.
export function parseMonthDayUTC(monthDay: string, referenceYear: number): number {
  return parseIsoDateUTC(`${referenceYear}-${monthDay}`);
}
