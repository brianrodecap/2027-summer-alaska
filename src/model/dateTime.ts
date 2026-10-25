const DATE_TIME_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// A real local date-time ('2027-07-11T08:00'): the shape, and a calendar day
// and clock time that exist — a lenient digit pattern lets 2027-07-32T24:75
// through to the overlap and route-walk math, which would run on NaN.
export function isDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_TIME_SHAPE.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return (
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === mo - 1 &&
    at.getUTCDate() === d &&
    h < 24 &&
    mi < 60
  );
}
