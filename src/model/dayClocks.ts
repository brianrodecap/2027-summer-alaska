// Which clock a day's rows read on, for showing it when a day crosses a zone
// line (a drive from Denver to Page, a flight to Anchorage) or a clock change:
// the day header's zone chip, zone labels on times, and a marker where the
// clocks go forward or back. Worked out once per day, in the order the rows
// show (each list's stay boundaries first and last, and each scenario box's
// active branch where the box sits), so the chip, the labels and the markers
// all read the same answer.
import { dragIdOf } from './reorder';
import {
  clockZoneOf,
  formatTime,
  instantOf,
  isKnownZone,
  onPlaceClock,
  orderInstant,
  splitOutStayBoundaries,
  type TripClock,
  type ZonedTime,
  zoneOffsetMs,
  zoneShortName,
} from './tripModel';
import type { Day, DayRow, Place } from './types';

// Where the clock moves, before the row it moves at: from one zone to another,
// or within one across a daylight-saving change. `minutes` is how far it moves
// (negative: back); the names are each side's as it reads there ('MDT', 'MST').
export interface ClockChange {
  minutes: number;
  from: string;
  to: string;
}

export interface DayClocks {
  // Each clock name the day's times show, in order ('MDT', 'MST'): its first,
  // then each one that differs from the one before, a move or not.
  names: string[];
  // Each move, by the drag id of the row it happens before.
  changes: Map<string, ClockChange>;
  // The places the day's rows are at that have a Google place id but no zone
  // recorded, which a re-pick in their edit form records: their times read on
  // the trip's clock, which can be wrong there. A route's stops and a routed
  // drive's ends belong to the Route, so they aren't listed.
  unzoned: string[];
}

type ClockDay = Pick<Day, 'rows' | 'clock' | 'date'>;

// A row's time, or null for one without (a Stay in progress, a box).
function rowTime(row: DayRow): ZonedTime | null {
  if (row.type === 'box' || !row.event?.at) return null;
  return { at: row.event.at, zone: row.event.zone };
}

// `shown` narrows each list to the rows it shows (a filter), so a move lands
// on a row that's there.
export function dayClocks(
  { rows, clock, date }: ClockDay,
  shown: (list: DayRow[]) => DayRow[] = (list) => list,
): DayClocks {
  const names: string[] = [];
  const changes = new Map<string, ClockChange>();
  const unzoned = new Map<string, string>(); // place id → label
  let previous: { zone: string; instant: number; offset: number } | null = null;
  const walk = (list: DayRow[]) => {
    const { checkOuts, rest, checkIns } = splitOutStayBoundaries(shown(list));
    for (const row of [...checkOuts, ...rest, ...checkIns]) {
      if (row.type === 'box') {
        for (const track of row.tracks) if (track.active) walk(track.rows);
        continue;
      }
      const place = rowPlace(row);
      const pickable = row.type !== 'transit' || !row.transit.routeId;
      if (pickable && place?.id && !place.onboard && !isKnownZone(place.timeZone ?? null)) {
        unzoned.set(place.id, place.label);
      }
      const here = clockAt(row, clock);
      if (!here) continue;
      const name = zoneShortName(here.zone, here.instant);
      if (names.at(-1) !== name) names.push(name);
      if (previous && here.offset !== previous.offset) {
        changes.set(dragIdOf(row, date), {
          minutes: here.offset - previous.offset,
          from: zoneShortName(previous.zone, previous.instant),
          to: name,
        });
      }
      previous = here;
    }
  };
  walk(rows);
  return { names, changes, unzoned: [...unzoned.values()] };
}

// The place a row is at, as the timeline resolved it (a still-open meal's is its
// selected candidate's), or a stay in progress's lodging.
function rowPlace(row: DayRow): Place | null {
  if (row.type === 'box') return null;
  return row.event?.place ?? (row.type === 'stay' ? (row.stay.lodging?.place ?? null) : null);
}

// The clock where the trip is, for a row whose booking states its own
// (clockZone): its place's, or its lodging's, so the booking doesn't read as the
// clocks moving. A ship's venue keeps the booking's clock (the ship's), and
// every other row the clock the day list orders it on (its event's).
function placeZone(row: DayRow): string | null {
  if (row.type === 'activity' && row.activity.clockZone && !row.activity.place?.onboard) {
    return row.activity.place?.timeZone ?? null;
  }
  return row.type === 'stay' && row.stay.clockZone
    ? (row.stay.lodging?.place.timeZone ?? null)
    : null;
}

// A row's clock where the trip is when it happens, and that clock's offset then
// in minutes.
function clockAt(row: DayRow, clock: TripClock) {
  const time = rowTime(row);
  const here = placeZone(row);
  const zone = time && (isKnownZone(here) ? here : clockZoneOf(time, clock));
  const offset = zone === null ? null : zoneOffsetMs(zone, row.order);
  return zone && offset !== null
    ? { zone, instant: row.order, offset: Math.round(offset / 60_000) }
    : null;
}

// The day's clocks, once per (live) Day.
const clocksOf = new WeakMap<ClockDay, DayClocks>();
export function dayClocksOf(day: ClockDay): DayClocks {
  let clocks = clocksOf.get(day);
  if (!clocks) clocksOf.set(day, (clocks = dayClocks(day)));
  return clocks;
}

// The clock `time` is on, to follow it (' MST'), on a day the clock moves on,
// where a bare 10:00am could be on either side; '' on a day on one clock.
export function clockSuffix(day: ClockDay, time: ZonedTime): string {
  if (!dayClocksOf(day).changes.size) return '';
  const zone = clockZoneOf(time, day.clock);
  return zone ? ` ${zoneShortName(zone, orderInstant(time, day.clock))}` : '';
}

// "Clocks go back 1 hour" / "Clocks go forward 30 min".
export function clockChangeLabel({ minutes }: ClockChange): string {
  const size = Math.abs(minutes);
  const amount = size % 60 === 0 ? `${size / 60} hour${size === 60 ? '' : 's'}` : `${size} min`;
  return `Clocks go ${minutes > 0 ? 'forward' : 'back'} ${amount}`;
}

// "Clocks go back 1 hour · MDT → MST": the move and, when they differ, the two
// clocks' names, as the day list's marker and a transit's sheet both say it.
export const clockChangeText = (change: ClockChange): string =>
  `${clockChangeLabel(change)}${change.from !== change.to ? ` · ${change.from} → ${change.to}` : ''}`;

// A booking stated on another clock than its place's, as the place reads it:
// "Booked on MDT · 9:00am MST here", so a time off the booking and one off a
// watch there both make sense. null when the two clocks agree or one is unknown.
export function bookingClockNote(
  at: string,
  bookingZone: string | null,
  placeZone: string | null | undefined,
): string | null {
  const instant = instantOf(at, bookingZone);
  if (instant === null || !isKnownZone(placeZone ?? null)) return null;
  const here = onPlaceClock(at, bookingZone, placeZone);
  if (here === at) return null;
  const booked = zoneShortName(bookingZone as string, instant);
  return `Booked on ${booked} · ${formatTime(here)} ${zoneShortName(placeZone as string, instant)} here`;
}
