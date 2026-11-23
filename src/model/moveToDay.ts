// Moving Activities, Transits and Stays to another day. Each keeps its time of
// day (a 2:00pm activity on Jul 2 becomes 2:00pm on Jul 3); a Transit and a Stay
// keep their length, so an overnight drive still arrives the next morning. A
// moved entry joins the leg it is given and, unless it moves as part of a plan
// group, leaves any weather plan it was in, so it happens on the new day whichever
// plan is picked. A plan group moves as one block: every entry in every plan shifts
// by the same days, keeping its plan and its offset from the rest.
//
// A planner leaves bad plans to the person: this refuses only what cannot be
// stored (a date that isn't one, an entry that no longer exists). Everything
// else goes ahead, and `moveNotes` says what the person should know first.
//
// Pure, like the rest of src/model.
import { bookingOf, isBought } from './bookings';
import { dayOfContainer, shiftedArrivesAt } from './reorder';
import {
  addDaysStr,
  dateOnly,
  departure,
  diffMinutesIso,
  legDateRange,
  minutesBetween,
  resolveActivityDate,
  type TripClock,
  tripClock,
} from './tripModel';
import type { Activity, Stay, Transit, TripData } from './types';

export interface MoveMembers {
  activityIds: string[];
  transitIds: string[];
  stayIds: string[];
  // Set when these entries are a plan group: the day the group sits on. They all
  // move by the days between it and the target, keeping their plans. Without it
  // each entry moves onto the target day.
  groupFrom?: string;
  // Set when these entries are everything movable on that day (see wholeDayMove): the
  // day's written title and its date notes move to the target date with them.
  wholeDay?: string;
}

export interface MoveTarget {
  date: string;
  legId: string;
}

// A date that exists on the calendar, not just one shaped like it.
const isRealDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && addDaysStr(date, 0) === date;

export type MoveResult = { data: TripData } | { error: string };

export const wholeDays = (from: string, to: string) =>
  Math.round(diffMinutesIso(`${from}T00:00`, `${to}T00:00`) / 1440);

const shiftedDateTime = (dateTime: string, days: number) =>
  `${addDaysStr(dateOnly(dateTime), days)}T${dateTime.slice(11)}`;

const shiftedOrNull = (dateTime: string | null, days: number) =>
  dateTime ? shiftedDateTime(dateTime, days) : null;

// How far an entry moves: by the group's days, or onto the target date. A moved
// entry joins the target leg and, unless it moves with a plan group, leaves its plan.
const daysFor = (move: MoveMembers, target: MoveTarget, entryDate: string) =>
  wholeDays(move.groupFrom ?? entryDate, target.date);

const placed = <T extends { scenarioId: string | null }>(
  entry: T,
  move: MoveMembers,
  target: MoveTarget,
): T => ({
  ...entry,
  legId: target.legId,
  scenarioId: move.groupFrom ? entry.scenarioId : null,
});

function movedActivity(a: Activity, move: MoveMembers, target: MoveTarget): Activity {
  if (a.startAt) {
    const startAt = shiftedDateTime(a.startAt, daysFor(move, target, dateOnly(a.startAt)));
    return { ...placed(a, move, target), startAt };
  }
  const date = a.date ? addDaysStr(a.date, daysFor(move, target, a.date)) : target.date;
  return { ...placed(a, move, target), date };
}

const shiftedTransit = (t: Transit, by: number, clock: TripClock): Transit => {
  const departsAt = shiftedDateTime(t.departsAt, by);
  const departs = departure(t);
  const deltaMinutes = minutesBetween(departs, { ...departs, at: departsAt }, clock);
  return { ...t, departsAt, arrivesAt: shiftedArrivesAt(t, deltaMinutes, clock) };
};

const movedTransit = (t: Transit, move: MoveMembers, target: MoveTarget, clock: TripClock) =>
  shiftedTransit(placed(t, move, target), daysFor(move, target, dateOnly(t.departsAt)), clock);

const shiftedStay = (s: Stay, by: number): Stay => ({
  ...s,
  checkInAt: shiftedDateTime(s.checkInAt, by),
  checkOutAt: shiftedDateTime(s.checkOutAt, by),
  portCalls: s.portCalls?.map((call) => ({
    ...call,
    arrivesAt: shiftedOrNull(call.arrivesAt, by),
    departsAt: shiftedOrNull(call.departsAt, by),
  })),
});

const movedStay = (s: Stay, move: MoveMembers, target: MoveTarget) =>
  shiftedStay(placed(s, move, target), daysFor(move, target, dateOnly(s.checkInAt)));

// The entries the moves name, by id, and whether every id was found. An entry named
// by a plan group and by a plain row moves with the group.
function resolveMoves(data: TripData, moves: MoveMembers[]) {
  const named = (pick: (m: MoveMembers) => string[]) => {
    const moveOf = new Map<string, MoveMembers>();
    for (const move of moves) {
      for (const id of pick(move)) if (move.groupFrom || !moveOf.has(id)) moveOf.set(id, move);
    }
    return moveOf;
  };
  const found = <T extends { _id: string }>(items: T[], moveOf: Map<string, MoveMembers>) => {
    const byId = new Map(items.map((item) => [item._id, item]));
    const hits = new Map<string, { entry: T; move: MoveMembers }>();
    for (const [id, move] of moveOf) {
      const entry = byId.get(id);
      if (entry) hits.set(id, { entry, move });
    }
    return hits;
  };
  const activityMoves = named((m) => m.activityIds);
  const transitMoves = named((m) => m.transitIds);
  const stayMoves = named((m) => m.stayIds);
  const activities = found(data.activities, activityMoves);
  const transits = found(data.transits, transitMoves);
  const stays = found(data.stays, stayMoves);
  return {
    activities,
    transits,
    stays,
    empty: !activityMoves.size && !transitMoves.size && !stayMoves.size,
    complete:
      activities.size === activityMoves.size &&
      transits.size === transitMoves.size &&
      stays.size === stayMoves.size,
  };
}

// A whole day's written title and date notes, moved to another date. A title already
// on the target date is replaced; a range note stays where it is.
function carryDay(
  data: TripData,
  from: string | undefined,
  to: string,
): Pick<TripData, 'dayTitles' | 'notes'> {
  if (!from) return { dayTitles: data.dayTitles, notes: data.notes };
  const title = data.dayTitles.find((t) => t._id === from);
  const others = data.dayTitles.filter((t) => t._id !== from && (!title || t._id !== to));
  return {
    dayTitles: title ? [...others, { ...title, _id: to }] : data.dayTitles,
    notes: data.notes.map((note) => ({
      ...note,
      concerns: note.concerns.map((ref) =>
        'date' in ref && ref.date === from ? { date: to } : ref,
      ),
    })),
  };
}

export function applyMoveToDay(
  data: TripData,
  moves: MoveMembers[],
  target: MoveTarget,
): MoveResult {
  if (!isRealDate(target.date)) return { error: 'Pick a day from the calendar.' };
  if (!data.legs.some((leg) => leg._id === target.legId)) {
    return { error: 'That leg is not part of this trip.' };
  }
  if (moves.some((m) => [m.groupFrom, m.wholeDay].some((d) => d !== undefined && !isRealDate(d)))) {
    return { error: 'A move names a day that is not a date.' };
  }
  const found = resolveMoves(data, moves);
  if (found.empty) return { error: 'Nothing to move.' };
  if (!found.complete) return { error: 'Some of these entries no longer exist.' };
  const clock = tripClock(data);
  const carried = carryDay(data, moves.find((m) => m.wholeDay)?.wholeDay, target.date);
  return {
    data: {
      ...data,
      ...carried,
      activities: data.activities.map((a) => {
        const hit = found.activities.get(a._id);
        return hit ? movedActivity(a, hit.move, target) : a;
      }),
      transits: data.transits.map((t) => {
        const hit = found.transits.get(t._id);
        return hit ? movedTransit(t, hit.move, target, clock) : t;
      }),
      stays: data.stays.map((s) => {
        const hit = found.stays.get(s._id);
        return hit ? movedStay(s, hit.move, target) : s;
      }),
    },
  };
}

// The leg whose dates are closest to a date no leg claims: a date inside a leg's
// range is distance 0, and ties go to the earlier leg in the list.
export function nearestLegId(
  legs: { legId: string; range: { startDate: string; endDate: string } | null }[],
  date: string,
): string | null {
  let best: { legId: string; away: number } | null = null;
  for (const { legId, range } of legs) {
    if (!range) continue;
    const away =
      date < range.startDate
        ? wholeDays(date, range.startDate)
        : date > range.endDate
          ? wholeDays(range.endDate, date)
          : 0;
    if (!best || away < best.away) best = { legId, away };
  }
  return best?.legId ?? null;
}

// Other legs that a move would run into, and how far each would have to shift to
// keep the gap it has now. A move to a date past the end of its leg stretches the
// leg later; one before its start stretches it earlier. Legs that begin at or after
// the old end (or end at or before the old start) and fall inside the stretched
// span are the ones offered a shift. Empty when nothing collides, which is the
// usual case: legs may share days, and a person may want them to.
export interface LegShift {
  legId: string;
  days: number;
}

export function legShiftOffer(
  data: TripData,
  moves: MoveMembers[],
  target: MoveTarget,
): LegShift[] {
  const moved = applyMoveToDay(data, moves, target);
  if (!('data' in moved)) return [];
  const found = resolveMoves(data, moves);
  const staying = {
    stays: data.stays.filter((x) => !found.stays.has(x._id)),
    transits: data.transits.filter((x) => !found.transits.has(x._id)),
    activities: data.activities.filter((x) => !found.activities.has(x._id)),
  };
  const was = legDateRange(target.legId, staying.stays, staying.transits, staying.activities);
  const now = legDateRange(
    target.legId,
    moved.data.stays,
    moved.data.transits,
    moved.data.activities,
  );
  if (!was || !now) return [];
  const shifts: LegShift[] = [];
  for (const leg of data.legs) {
    if (leg._id === target.legId) continue;
    const range = legDateRange(
      leg._id,
      moved.data.stays,
      moved.data.transits,
      moved.data.activities,
    );
    if (!range) continue;
    if (
      now.endDate > was.endDate &&
      range.startDate >= was.endDate &&
      range.startDate < now.endDate
    ) {
      shifts.push({ legId: leg._id, days: wholeDays(was.endDate, now.endDate) });
    } else if (
      now.startDate < was.startDate &&
      range.endDate <= was.startDate &&
      range.endDate > now.startDate
    ) {
      shifts.push({ legId: leg._id, days: -wholeDays(now.startDate, was.startDate) });
    }
  }
  return shifts;
}

// How far a date moves when legs shift: with the shifted leg that claims it, unless
// a leg that stays also claims it (a day the legs share stays put).
function dateShifter(data: TripData, shifts: LegShift[]): (date: string) => number {
  const range = (legId: string) => legDateRange(legId, data.stays, data.transits, data.activities);
  const moving = shifts.flatMap((shift) => {
    const r = range(shift.legId);
    return r ? [{ ...r, days: shift.days }] : [];
  });
  const shiftedIds = new Set(shifts.map((shift) => shift.legId));
  const staying = data.legs.flatMap((leg) => {
    const r = shiftedIds.has(leg._id) ? null : range(leg._id);
    return r ? [r] : [];
  });
  return (date) => {
    const inRange = (r: { startDate: string; endDate: string }) =>
      r.startDate <= date && date <= r.endDate;
    return staying.some(inRange) ? 0 : (moving.find(inRange)?.days ?? 0);
  };
}

// Every dated entry of the given legs, moved by whole days, and with them the day
// titles and date notes on the days only those legs claim.
//
// `ranges` is the data the legs' days are read from: after a move that stretches a
// leg over the ones being shifted, that is the data from before the move, where
// the days still belong to the leg being shifted.
export function shiftLegs(data: TripData, shifts: LegShift[], ranges: TripData = data): TripData {
  const byLeg = new Map(shifts.map((shift) => [shift.legId, shift.days]));
  const clock = tripClock(data);
  const shiftFor = dateShifter(ranges, shifts);
  const shiftedDate = (date: string) => addDaysStr(date, shiftFor(date));
  const movedTitles = data.dayTitles
    .filter((t) => shiftFor(t._id))
    .map((t) => ({ ...t, _id: shiftedDate(t._id) }));
  const landedOn = new Set(movedTitles.map((t) => t._id));
  return {
    ...data,
    activities: data.activities.map((a) => {
      const by = byLeg.get(a.legId);
      if (!by) return a;
      if (a.startAt) return { ...a, startAt: shiftedDateTime(a.startAt, by) };
      return a.date ? { ...a, date: addDaysStr(a.date, by) } : a;
    }),
    transits: data.transits.map((t) => {
      const by = byLeg.get(t.legId);
      return by ? shiftedTransit(t, by, clock) : t;
    }),
    stays: data.stays.map((s) => {
      const by = byLeg.get(s.legId);
      return by ? shiftedStay(s, by) : s;
    }),
    // A title that lands on a date takes it from one already there.
    dayTitles: [
      ...data.dayTitles.filter((t) => !shiftFor(t._id) && !landedOn.has(t._id)),
      ...movedTitles,
    ],
    notes: data.notes.map((note) => ({
      ...note,
      concerns: note.concerns.map((ref) => {
        if ('date' in ref) return { date: shiftedDate(ref.date) };
        if (!('dateRange' in ref)) return ref;
        const [from, to] = ref.dateRange;
        const by = shiftFor(from);
        return by && by === shiftFor(to)
          ? { dateRange: [addDaysStr(from, by), addDaysStr(to, by)] as [string, string] }
          : ref;
      }),
    })),
  };
}

// What the person should know before picking a day: bought bookings are real
// reservations, so a move changes the plan and not the booking; a plan group
// moves whole; stays move with their dates (a drag leaves them where they are); and entries moved on their own leave their weather plan. Empty
// when there is nothing to say.
export function moveNotes(data: TripData, moves: MoveMembers[]): string[] {
  const found = resolveMoves(data, moves);
  const hits = [...found.activities.values(), ...found.transits.values(), ...found.stays.values()];
  const notes: string[] = [];
  const booked = hits.filter(({ entry }) => isBought(bookingOf(data, entry)?.status)).length;
  if (booked) {
    notes.push(
      booked === 1
        ? '1 of these is booked. Moving it changes the plan, not the booking.'
        : `${booked} of these are booked. Moving them changes the plan, not the bookings.`,
    );
  }
  const grouped = hits.filter(({ move }) => move.groupFrom).length;
  if (grouped) {
    notes.push(
      `Moves the whole plan group (${grouped} ${grouped === 1 ? 'entry' : 'entries'}), keeping its plans and timing.`,
    );
  }
  if (found.stays.size) {
    notes.push(
      found.stays.size === 1
        ? 'Moves 1 stay too: its check-in and check-out dates shift with it.'
        : `Moves ${found.stays.size} stays too: their check-in and check-out dates shift with them.`,
    );
  }
  const day = moves.find((m) => m.wholeDay)?.wholeDay;
  if (
    day &&
    (data.dayTitles.some((t) => t._id === day) ||
      data.notes.some((n) => n.concerns.some((r) => 'date' in r && r.date === day)))
  ) {
    notes.push('Takes the day’s title and notes along, replacing any title on the day you pick.');
  }
  const plans = [
    ...new Set(
      hits.flatMap(({ entry, move }) =>
        entry.scenarioId && !move.groupFrom ? [entry.scenarioId] : [],
      ),
    ),
  ].map((id) => data.scenarios.find((s) => s._id === id)?.label ?? id);
  if (plans.length) {
    notes.push(
      `Leaves the plan ${plans.map((label) => `“${label}”`).join(', ')}: it happens on the new day whichever plan is picked.`,
    );
  }
  return notes;
}

// What a selection of rows moves as: each plan group on its own (it keeps its
// plans and timing), and every other row together.
export function selectionToMove(
  rows: { members: MoveMembers; isScenarioGroup: boolean; containerId: string }[],
): MoveMembers[] {
  const plain = rows.filter((row) => !row.isScenarioGroup);
  const groups: MoveMembers[] = rows
    .filter((row) => row.isScenarioGroup)
    .map((row) => ({ ...row.members, groupFrom: dayOfContainer(row.containerId) ?? undefined }));
  const gather = (key: 'activityIds' | 'transitIds' | 'stayIds') => [
    ...new Set(plain.flatMap((row) => row.members[key])),
  ];
  const together = {
    activityIds: gather('activityIds'),
    transitIds: gather('transitIds'),
    stayIds: gather('stayIds'),
  };
  return together.activityIds.length || together.transitIds.length || together.stayIds.length
    ? [together, ...groups]
    : groups;
}

// The same as selectionToMove, for a day moved whole: its title and date notes go too.
export function wholeDayMove(
  rows: Parameters<typeof selectionToMove>[0],
  date: string,
): MoveMembers[] {
  return selectionToMove(rows).map((move) => ({ ...move, wholeDay: date }));
}

// Where the first entry being moved sits now: the day and leg a picker can start
// from.
export function movedFrom(
  data: TripData,
  moves: MoveMembers[],
): { date: string | null; legId: string } | null {
  const { activities, transits, stays } = resolveMoves(data, moves);
  const a = [...activities.values()][0]?.entry;
  if (a) return { date: resolveActivityDate(a), legId: a.legId };
  const t = [...transits.values()][0]?.entry;
  if (t) return { date: dateOnly(t.departsAt), legId: t.legId };
  const s = [...stays.values()][0]?.entry;
  return s ? { date: dateOnly(s.checkInAt), legId: s.legId } : null;
}

// The leg to suggest on a day where the trip changes legs: the one the first moved
// entry is in now, when that leg claims the day.
export function suggestedLegId(from: { legId: string } | null, dayLegIds: string[]): string | null {
  return from && dayLegIds.includes(from.legId) ? from.legId : null;
}
