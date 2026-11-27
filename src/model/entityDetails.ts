// An expanded card's lines for what an entity records beyond its booking: when it
// runs, its packages' costs and a cruise's port calls (whose one-day wording the
// day header shares). Pure; the day and detail components render these.
import { clockChangeText } from './dayClocks';
import { countLabel, formatMinutes } from './formatting';
import {
  dateOnly,
  endpointZonesOf,
  formatDateLabel,
  formatMoney,
  formatTime,
  instantOf,
  packageTotal,
  packageUnits,
  stayNights,
  wallClockMs,
  zoneShortName,
} from './tripModel';
import type { Package, PortCall, Stay, Transit } from './types';

// "3:00pm in · 11:00am out" on one day; once the two ends fall on different
// days each gets its date: "Sat Jul 17, 3:00pm in → Sat Jul 24, 7:30am out".
export function spanLabel(
  start: string,
  end: string | null,
  words: { start: string; end: string; endMissing?: string },
): string {
  const multiDay = end !== null && dateOnly(end) !== dateOnly(start);
  const at = (iso: string) =>
    multiDay ? `${formatDateLabel(dateOnly(iso))}, ${formatTime(iso)}` : formatTime(iso);
  const tail = end ? `${at(end)} ${words.end}` : (words.endMissing ?? '');
  return `${at(start)} ${words.start}${multiDay ? ' → ' : ' · '}${tail}`;
}

// "Sat Jul 17, 3:00pm in → Sat Jul 24, 7:30am out · 7 nights".
export function stayWhenLabel(stay: Pick<Stay, 'checkInAt' | 'checkOutAt'>): string {
  const span = spanLabel(stay.checkInAt, stay.checkOutAt, { start: 'in', end: 'out' });
  const nights = stayNights(stay);
  return nights > 0 ? `${span} · ${countLabel(nights, 'night')}` : span;
}

type TransitTimes = Pick<Transit, 'departsAt' | 'arrivesAt' | 'from' | 'to'>;

// How long the trip takes, each end read on its own clock, so a Seattle 08:55 →
// Anchorage 10:33 flight is 2 hr 38 min. Null unless both zones are known: a
// difference of the stored local times is wrong across a zone line.
export function transitDurationMinutes(transit: TransitTimes): number | null {
  const { departsAt, arrivesAt } = transit;
  const zones = endpointZonesOf(transit);
  const departs = instantOf(departsAt, zones.from);
  const arrives = arrivesAt ? instantOf(arrivesAt, zones.to) : null;
  if (departs === null || arrives === null) return null;
  const minutes = (arrives - departs) / 60_000;
  return minutes > 0 ? minutes : null;
}

// "8:55am depart · 10:33am arrive", plus "· 1 hr 38 min" once both ends' zones
// are known, and where the clock moves on the way, the move and both clocks:
// "· Clocks go back 1 hour · EDT → CDT".
export function transitWhenLabel(transit: TransitTimes): string {
  const span = spanLabel(transit.departsAt, transit.arrivesAt, {
    start: 'depart',
    end: 'arrive',
    endMissing: 'arrival time TBD',
  });
  const minutes = transitDurationMinutes(transit);
  if (minutes === null) return span;
  const moved = clockMove(transit, minutes);
  return `${span} · ${formatMinutes(minutes)}${moved ? ` · ${moved}` : ''}`;
}

// "Clocks go back 1 hour · PDT → AKDT" for a trip the clock moves on: the move is
// the wall-clock difference less the real one (`minutes`). null when it doesn't.
function clockMove(transit: TransitTimes, minutes: number): string | null {
  const arrivesAt = transit.arrivesAt as string;
  const moved = Math.round(
    (wallClockMs(arrivesAt) - wallClockMs(transit.departsAt)) / 60_000 - minutes,
  );
  if (!moved) return null;
  const zones = endpointZonesOf(transit);
  const from = zoneShortName(
    zones.from as string,
    instantOf(transit.departsAt, zones.from) as number,
  );
  const to = zoneShortName(zones.to as string, instantOf(arrivesAt, zones.to) as number);
  return clockChangeText({ minutes: moved, from, to });
}

// "$100.00", or for a nightly rate on a Stay "$25.00 / night · $150.00 for 6
// nights" — the same units the budget charges (packageUnits). null when unpriced.
export function packageCostLabel(pkg: Package, nights: number | null): string | null {
  // A Transit's or Activity's packages (nights null) are charged once, as in the budget.
  if (!pkg.cost || pkg.per !== 'night' || nights === null) return formatMoney(pkg.cost);
  const units = packageUnits(pkg, nights);
  return `${formatMoney(pkg.cost)} / night · ${formatMoney(packageTotal(pkg, units))} for ${countLabel(units, 'night')}`;
}

// "Sun Jul 18 · 3:00pm–8:00pm", "Mon Jul 19, 8:00pm → Tue Jul 20, 6:00am"
// for an overnight call, or whichever end was printed.
export function portCallWhenLabel(call: PortCall): string {
  const { arrivesAt, departsAt } = call;
  const day = (iso: string) => formatDateLabel(dateOnly(iso));
  if (arrivesAt && departsAt) {
    return dateOnly(arrivesAt) === dateOnly(departsAt)
      ? `${day(arrivesAt)} · ${formatTime(arrivesAt)}–${formatTime(departsAt)}`
      : `${day(arrivesAt)}, ${formatTime(arrivesAt)} → ${day(departsAt)}, ${formatTime(departsAt)}`;
  }
  if (arrivesAt) return `${day(arrivesAt)} · arrives ${formatTime(arrivesAt)}`;
  if (departsAt) return `${day(departsAt)} · leaves ${formatTime(departsAt)}`;
  return 'Times not printed';
}

// The icon a port call shows: a ship cruising past scenery, or lying in port.
export const portCallIcon = (kind: PortCall['kind']) =>
  kind === 'scenic' ? 'landscape' : 'anchor';

// Only the end(s) of the stop that fall on `date`: an overnight stay reads
// "Arrives 8:00 PM" on its first day and "All aboard 6:00 AM" on its last.
export function portCallDayLabel(call: PortCall, date: string): string {
  const arrivesToday = !!call.arrivesAt && dateOnly(call.arrivesAt) === date;
  const departsToday = !!call.departsAt && dateOnly(call.departsAt) === date;
  const where = call.kind === 'scenic' ? `Cruising past ${call.place.label}` : call.place.label;
  const aboard = call.kind === 'port' ? 'All aboard' : 'Leaves';
  const at = (t: string | null | undefined) => (t ? formatTime(t) : '');
  if (arrivesToday && departsToday) {
    return `${where} · ${at(call.arrivesAt)}–${at(call.departsAt)}${call.kind === 'port' ? ' (all aboard)' : ''}`;
  }
  if (arrivesToday)
    return `${where} · Arrives ${at(call.arrivesAt)}${call.departsAt ? ' · overnight' : ''}`;
  if (departsToday) return `${where} · ${aboard} ${at(call.departsAt)}`;
  return where;
}

// Port calls in the order the ship makes them; a call with neither time
// printed keeps its place at the end.
export function portCallsInOrder(calls: PortCall[] | null | undefined): PortCall[] {
  const key = (c: PortCall) => c.arrivesAt ?? c.departsAt;
  return [...(calls ?? [])].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  });
}
