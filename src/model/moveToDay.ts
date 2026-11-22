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
}

export interface MoveTarget {
  date: string;
  legId: string;
}

export type MoveResult = { data: TripData } | { error: string };

const wholeDays = (from: string, to: string) =>
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

function movedTransit(
  t: Transit,
  move: MoveMembers,
  target: MoveTarget,
  clock: TripClock,
): Transit {
  const departsAt = shiftedDateTime(t.departsAt, daysFor(move, target, dateOnly(t.departsAt)));
  const departs = departure(t);
  const deltaMinutes = minutesBetween(departs, { ...departs, at: departsAt }, clock);
  return {
    ...placed(t, move, target),
    departsAt,
    arrivesAt: shiftedArrivesAt(t, deltaMinutes, clock),
  };
}

function movedStay(s: Stay, move: MoveMembers, target: MoveTarget): Stay {
  const by = daysFor(move, target, dateOnly(s.checkInAt));
  return {
    ...placed(s, move, target),
    checkInAt: shiftedDateTime(s.checkInAt, by),
    checkOutAt: shiftedDateTime(s.checkOutAt, by),
    portCalls: s.portCalls?.map((call) => ({
      ...call,
      arrivesAt: shiftedOrNull(call.arrivesAt, by),
      departsAt: shiftedOrNull(call.departsAt, by),
    })),
  };
}

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

export function applyMoveToDay(
  data: TripData,
  moves: MoveMembers[],
  target: MoveTarget,
): MoveResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target.date)) return { error: 'Pick a day from the calendar.' };
  if (!data.legs.some((leg) => leg._id === target.legId)) {
    return { error: 'That leg is not part of this trip.' };
  }
  const found = resolveMoves(data, moves);
  if (found.empty) return { error: 'Nothing to move.' };
  if (!found.complete) return { error: 'Some of these entries no longer exist.' };
  const clock = tripClock(data);
  return {
    data: {
      ...data,
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

// What the person should know before picking a day: bought bookings are real
// reservations, so a move changes the plan and not the booking; a plan group
// moves whole; and entries moved on their own leave their weather plan. Empty
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
