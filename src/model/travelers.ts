// Merging two Trip.travelers entries that turn out to be one person — most
// often a traveler a document import added (see documentImport.ts's
// withDocumentTravelers) because the document spelled an existing traveler's
// name differently. Pure, like tripModel.ts: the caller commits the result
// through TripDataContext's setData, so the merge is one undoable change.
//
// A traveler id is referenced from five places — TRAVELER_SLOTS below, which
// both travelerUsage and mergeTravelers read, so a new one can't be counted
// without also being repointed, or the reverse.

import { bookingFares } from './bookings';
import type { PassengerFare, SeatAssignment, Traveler, TripData } from './types';

type TravelerData = Pick<TripData, 'trip' | 'transits' | 'activities' | 'stays' | 'bookings'>;

// How much of the trip names a traveler — shown beside each one so the reader
// can tell which of two duplicates is the established one to keep.
export interface TravelerUsage {
  transits: number;
  activities: number;
  packages: number;
  seats: number;
  fares: number;
}

interface MergeIds {
  keepId: string;
  mergeId: string;
}

// One place a traveler id can appear: how many times it names `id`, and the
// same data with `mergeId` folded into `keepId` (a document that doesn't name
// `mergeId` keeps its identity, so the change log records only what moved).
interface TravelerSlot {
  count: (data: TravelerData, id: string) => number;
  repoint: <T extends TravelerData>(data: T, ids: MergeIds) => T;
}

const named = (list: string[] | null | undefined, id: string) => !!list?.includes(id);

const TRAVELER_SLOTS: Record<keyof TravelerUsage, TravelerSlot> = {
  transits: {
    count: (data, id) => data.transits.filter((t) => named(t.travelers, id)).length,
    repoint: (data, ids) => ({
      ...data,
      transits: data.transits.map((t) => {
        const travelers = repointList(t.travelers, ids);
        return travelers === t.travelers ? t : { ...t, travelers };
      }),
    }),
  },
  activities: {
    count: (data, id) => data.activities.filter((a) => named(a.travelers, id)).length,
    repoint: (data, ids) => ({
      ...data,
      activities: data.activities.map((a) => {
        const travelers = repointList(a.travelers, ids);
        return travelers === a.travelers ? a : { ...a, travelers };
      }),
    }),
  },
  packages: {
    count: (data, id) =>
      data.stays.flatMap((s) => s.packages ?? []).filter((p) => named(p.travelers, id)).length,
    repoint: (data, ids) => ({
      ...data,
      stays: data.stays.map((s) => {
        if (!s.packages?.some((p) => named(p.travelers, ids.mergeId))) return s;
        return {
          ...s,
          packages: s.packages.map((p) => ({ ...p, travelers: repointList(p.travelers, ids) })),
        };
      }),
    }),
  },
  seats: {
    count: (data, id) =>
      data.transits.flatMap((t) => t.seats ?? []).filter((s) => s.travelerId === id).length,
    repoint: (data, ids) => ({
      ...data,
      transits: data.transits.map((t) => {
        const seats = t.seats && combine(t.seats, ids, resolveSeatConflict);
        return seats === t.seats ? t : { ...t, seats };
      }),
    }),
  },
  fares: {
    count: (data, id) =>
      data.bookings.flatMap((b) => bookingFares(b) ?? []).filter((f) => f.travelerId === id).length,
    repoint: (data, ids) => ({
      ...data,
      bookings: data.bookings.map((b) => {
        const current = bookingFares(b);
        if (!current || !b.pricing) return b;
        const fares = combine(current, ids, resolveFareConflict);
        return fares === current ? b : { ...b, pricing: { ...b.pricing, perTraveler: fares } };
      }),
    }),
  },
};

const SLOT_NAMES = Object.keys(TRAVELER_SLOTS) as (keyof TravelerUsage)[];

export function travelerUsage(data: TravelerData, id: string): TravelerUsage {
  const usage = {} as TravelerUsage;
  for (const name of SLOT_NAMES) usage[name] = TRAVELER_SLOTS[name].count(data, id);
  return usage;
}

export function formatTravelerUsage(usage: TravelerUsage): string {
  const parts = [
    [usage.transits, 'transit'],
    [usage.activities, 'activity'],
    [usage.packages, 'package'],
    [usage.seats, 'seat'],
    [usage.fares, 'fare'],
  ] as const;
  const named = parts
    .filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${n === 1 ? noun : noun === 'activity' ? 'activities' : `${noun}s`}`);
  return named.length ? named.join(' · ') : 'Not named on anything yet (whole party only)';
}

// Both travelers hold a fare on the same booking — two tickets recorded for
// what is now one person, so the duplicate's fare is the mistake and is
// dropped. The kept traveler's fare stands as it is, which lowers the
// booking's total by the dropped fare.
function resolveFareConflict(kept: PassengerFare): PassengerFare {
  return kept;
}

// Both travelers hold a seat on the same flight. The kept traveler's seat
// wins; a cabin or fare class only the other seat recorded is carried over.
function resolveSeatConflict(kept: SeatAssignment, merged: SeatAssignment): SeatAssignment {
  return {
    ...kept,
    ...(kept.cabin || !merged.cabin ? {} : { cabin: merged.cabin }),
    ...(kept.fareClass || !merged.fareClass ? {} : { fareClass: merged.fareClass }),
  };
}

// A list naming `mergeId` names `keepId` instead, de-duplicated. null
// ("whole party") is untouched — it already covers whoever remains.
function repointList(list: string[] | null, { keepId, mergeId }: MergeIds): string[] | null {
  return list?.includes(mergeId)
    ? [...new Set(list.map((id) => (id === mergeId ? keepId : id)))]
    : list;
}

// Folds `mergeId`'s entry into `keepId`'s in a per-traveler list (seats on
// one flight, fares on one booking), resolving a clash when both have one.
function combine<E extends { travelerId: string }>(
  entries: E[],
  { keepId, mergeId }: MergeIds,
  resolve: (kept: E, merged: E) => E,
): E[] {
  const theirs = entries.find((e) => e.travelerId === mergeId);
  if (!theirs) return entries;
  const ours = entries.find((e) => e.travelerId === keepId);
  return entries.flatMap((e) => {
    if (e === theirs) return ours ? [] : [{ ...theirs, travelerId: keepId }];
    if (e === ours) return [resolve(ours, theirs)];
    return [e];
  });
}

// Repoints everything that names `mergeId` at `keepId` and removes `mergeId`
// from the trip. The kept traveler keeps their own name; an age only the
// merged one recorded is carried over.
export function mergeTravelers<T extends TravelerData>(
  data: T,
  keepId: string,
  mergeId: string,
): T {
  const kept = data.trip.travelers.find((t) => t.id === keepId);
  const merged = data.trip.travelers.find((t) => t.id === mergeId);
  if (!kept || !merged || keepId === mergeId) return data;

  const keptTraveler: Traveler =
    kept.age == null && merged.age != null ? { ...kept, age: merged.age } : kept;
  const withoutMerged: T = {
    ...data,
    trip: {
      ...data.trip,
      travelers: data.trip.travelers
        .filter((t) => t.id !== mergeId)
        .map((t) => (t.id === keepId ? keptTraveler : t)),
    },
  };
  return SLOT_NAMES.reduce(
    (next, name) => TRAVELER_SLOTS[name].repoint(next, { keepId, mergeId }),
    withoutMerged,
  );
}
