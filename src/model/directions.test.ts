import { describe, expect, it } from 'vitest';

import {
  type DriveLookup,
  recomputeVariant,
  removeRouteStage,
  replaceRouteStagePlace,
} from './directions';
import type { RouteVariant } from './types';

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

describe('removeRouteStage', () => {
  it('removes the stage at its index, not another, and re-times the route from there', async () => {
    const lookup = drives({ 'from>a': 10, 'a>c': 30, 'c>to': 40 });
    const next = await removeRouteStage(variant(['a', 'b', 'c']), 1, 'from', 'to', lookup);
    expect(next.places.map((p) => p.place?.id)).toEqual(['a', 'c']);
    // Stages before the removed one keep their stored travel.
    expect(next.places.map((p) => p.travel)).toEqual([stored, { minutes: 30, miles: 15 }]);
    expect(next.finalTravel).toEqual({ minutes: 40, miles: 20 });
  });
});

describe('replaceRouteStagePlace', () => {
  it('sets the place at its index, not another, and re-times the route from there', async () => {
    const lookup = drives({ 'from>a': 10, 'a>x': 20, 'x>c': 30, 'c>to': 40 });
    const place = { id: 'x', label: 'Picked', images: [] };
    const next = await replaceRouteStagePlace(
      variant(['a', 'b', 'c']),
      1,
      place,
      'from',
      'to',
      lookup,
    );
    expect(next.places.map((p) => p.place?.id)).toEqual(['a', 'x', 'c']);
    expect(next.places.map((p) => p.travel?.minutes)).toEqual([1, 20, 30]);
    expect(next.finalTravel?.minutes).toBe(40);
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
