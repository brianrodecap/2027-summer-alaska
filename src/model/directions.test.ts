import { describe, expect, it } from 'vitest';

import { applyTravel, type DriveLookup, recomputeVariant, reorderRouteStages } from './directions';
import type { Route, RouteVariant } from './types';

// Canned drive times by origin→destination; any other pair has no route.
function drives(table: Record<string, number>): DriveLookup {
  return async (origin, dest) => {
    const minutes = table[`${origin}>${dest}`];
    return minutes === undefined ? null : { minutes, miles: minutes / 2 };
  };
}

const stored = { minutes: 1 };

function variant(ids: (string | null)[]): RouteVariant {
  return {
    id: 'direct',
    tone: 'direct',
    label: 'Test variant',
    places: ids.map((id) => ({
      kind: 'waypoint' as const,
      place: { id, label: id ?? 'Unresolved' },
      travel: stored,
    })),
    finalTravel: stored,
  };
}

describe('reorderRouteStages', () => {
  it('puts the places in the given order and re-times the route from the first one that moved', async () => {
    const lookup = drives({ 'a>c': 30, 'c>b': 20, 'b>to': 40 });
    const next = await reorderRouteStages(
      variant(['a', 'b', 'c']),
      [0, 2, 1],
      'from',
      'to',
      lookup,
    );
    expect(next.places.map((p) => p.place?.id)).toEqual(['a', 'c', 'b']);
    // The leg before the first moved place keeps its stored travel.
    expect(next.places.map((p) => p.travel)).toEqual([
      stored,
      { minutes: 30, miles: 15 },
      { minutes: 20, miles: 10 },
    ]);
    expect(next.finalTravel).toEqual({ minutes: 40, miles: 20 });
  });

  it('re-times every leg after the first move, and keeps a place-less stage in place', async () => {
    const lookup = drives({ 'from>b': 10, 'b>a': 20, 'a>to': 40 });
    const next = await reorderRouteStages(
      variant(['a', null, 'b']),
      [2, 1, 0],
      'from',
      'to',
      lookup,
    );
    expect(next.places.map((p) => p.place?.id)).toEqual(['b', null, 'a']);
    // the place-less stage keeps its stored travel, and the next leg starts from the last resolved place
    expect(next.places.map((p) => p.travel)).toEqual([
      { minutes: 10, miles: 5 },
      stored,
      { minutes: 20, miles: 10 },
    ]);
    expect(next.finalTravel).toEqual({ minutes: 40, miles: 20 });
  });

  it('returns the variant itself when nothing moved', async () => {
    const v = variant(['a', 'b']);
    expect(await reorderRouteStages(v, [0, 1], 'from', 'to')).toBe(v);
  });
});

describe('applyTravel', () => {
  const route = (ids: (string | null)[], extra: Partial<RouteVariant> = {}, fromId = 'from') =>
    ({
      from: { id: fromId, label: 'From' },
      to: { id: 'to', label: 'To' },
      variants: [{ ...variant(ids), ...extra }],
    }) as unknown as Route;
  const timed = (r: Route, minutes: number): Route => ({
    ...r,
    variants: r.variants.map((v) => ({
      ...v,
      places: v.places.map((p) => ({ ...p, travel: { minutes } })),
      finalTravel: { minutes: minutes + 1 },
    })),
  });

  it('takes the new travel and keeps what was edited while the lookups ran', () => {
    const computed = timed(route(['a', 'b']), 20);
    const latest = route(['a', 'b'], { label: 'Renamed' });
    latest.variants[0].places[1].note = 'typed meanwhile';
    const next = applyTravel(latest, computed);
    expect(next.variants[0].label).toBe('Renamed');
    expect(next.variants[0].places[1].note).toBe('typed meanwhile');
    expect(next.variants[0].places.map((p) => p.travel.minutes)).toEqual([20, 20]);
    expect(next.variants[0].finalTravel.minutes).toBe(21);
  });

  it('pairs variants by id, not position', () => {
    const latest = route(['a']);
    latest.variants.unshift({ ...variant(['a']), id: 'other', label: 'Other' });
    const computed = timed(route(['a']), 20);
    const next = applyTravel(latest, computed);
    expect(next.variants[0].places[0].travel).toEqual(stored);
    expect(next.variants[1].places[0].travel.minutes).toBe(20);
  });

  it('leaves a variant alone once its places are no longer the ones computed for', () => {
    const latest = route(['a', 'c']);
    expect(applyTravel(latest, timed(route(['a', 'b']), 20))).toEqual(latest);
  });

  it('leaves the route alone once its ends have changed', () => {
    const latest = route(['a'], {}, 'elsewhere');
    expect(applyTravel(latest, timed(route(['a']), 20))).toEqual(latest);
  });
});

describe('recomputeVariant', () => {
  it('times each stage from the last resolved place before it', async () => {
    const lookup = drives({ 'from>a': 10, 'a>c': 30, 'c>to': 40 });
    const next = await recomputeVariant(variant(['a', null, 'c']), 'from', 'to', 0, lookup);
    expect(next.places.map((p) => p.travel?.minutes)).toEqual([10, 1, 30]);
    expect(next.finalTravel?.minutes).toBe(40);
  });

  it('keeps the stored travel where a lookup finds no route or fails', async () => {
    const failing: DriveLookup = async (origin) => {
      if (origin === 'a') throw new Error('quota');
      return null;
    };
    const next = await recomputeVariant(variant(['a', 'b']), 'from', 'to', 0, failing);
    expect(next.places.map((p) => p.travel)).toEqual([stored, stored]);
    expect(next.finalTravel).toEqual(stored);
  });
});
