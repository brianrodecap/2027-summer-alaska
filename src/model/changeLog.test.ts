import { describe, expect, it } from 'vitest';

import {
  type Change,
  changedCollections,
  diffTripData,
  hashDoc,
  replayChanges,
  stableStringify,
} from './changeLog';
import type { Activity, TravelModeOverride, TripData } from './types';

// The change log never looks inside an entity beyond its key, so these synthetic
// activities only carry the fields the assertions read.
function act(id: string, text: string): Activity {
  return { _id: id, text } as unknown as Activity;
}

function trip(activities: Activity[], travelModeOverrides: TravelModeOverride[] = []): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
    legs: [],
    stays: [],
    transits: [],
    activities,
    scenarios: [],
    notes: [],
    travelModeOverrides,
    routes: [],
  } as unknown as TripData;
}

const META = { batch: 'b1', at: '2026-10-02T12:00:00.000Z', source: 'manual' as const };

function ids(data: TripData): string[] {
  return data.activities.map((a) => a._id);
}

// The invariant everything else rests on: replaying what diffTripData recorded over
// the baseline reproduces exactly the data the edit produced.
function roundTrip(baseline: TripData, next: TripData): TripData {
  return replayChanges(baseline, diffTripData(baseline, next, baseline, META)).data;
}

describe('stableStringify / hashDoc', () => {
  it('ignores object key order', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableStringify({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(hashDoc({ a: 1, b: 2 })).toBe(hashDoc({ b: 2, a: 1 }));
  });

  it('keeps array order significant', () => {
    expect(hashDoc([1, 2])).not.toBe(hashDoc([2, 1]));
  });
});

describe('diffTripData', () => {
  const a = act('a', 'Kayak');
  const b = act('b', 'Hike');
  const c = act('c', 'Dinner');
  const baseline = trip([a, b, c]);

  it('records nothing when no collection array changed identity', () => {
    expect(diffTripData(baseline, { ...baseline }, baseline, META)).toEqual([]);
  });

  it('skips an entity that was rebuilt but is structurally identical', () => {
    const next = trip([{ ...a }, b, c]);
    expect(diffTripData(baseline, next, baseline, META)).toEqual([]);
  });

  it('records an edit as an upsert carrying the shipped hash', () => {
    const edited = act('b', 'Long hike');
    const changes = diffTripData(baseline, trip([a, edited, c]), baseline, META);
    expect(changes).toEqual([
      {
        ...META,
        collection: 'activities',
        op: 'upsert',
        key: 'b',
        doc: edited,
        baseHash: hashDoc(b),
      },
    ]);
  });

  it('records an addition with a null baseHash and no order op when appended', () => {
    const d = act('d', 'Museum');
    const changes = diffTripData(baseline, trip([a, b, c, d]), baseline, META);
    expect(changes.map((ch) => [ch.op, 'key' in ch ? ch.key : null])).toEqual([['upsert', 'd']]);
    expect(changes[0]).toMatchObject({ baseHash: null });
  });

  it('records a deletion', () => {
    const changes = diffTripData(baseline, trip([a, c]), baseline, META);
    expect(changes).toEqual([
      {
        ...META,
        collection: 'activities',
        op: 'delete',
        key: 'b',
        baseHash: hashDoc(b),
      },
    ]);
  });

  it('records a pure reorder as an order op', () => {
    const changes = diffTripData(baseline, trip([c, a, b]), baseline, META);
    expect(changes).toEqual([
      { ...META, collection: 'activities', op: 'order', keys: ['c', 'a', 'b'] },
    ]);
  });

  it('records an insertion in the middle as upsert plus order', () => {
    const d = act('d', 'Museum');
    const changes = diffTripData(baseline, trip([a, d, b, c]), baseline, META);
    expect(changes.map((ch) => ch.op)).toEqual(['upsert', 'order']);
  });

  it('records a change to the trip document (a new traveler) and replays it', () => {
    const before = trip([a]);
    const after = {
      ...before,
      trip: { ...before.trip, travelers: [{ id: 'trav_new', name: 'Pat Guest' }] },
    };
    const changes = diffTripData(before, after, before, META);
    expect(changes).toEqual([
      expect.objectContaining({ collection: 'trip', op: 'upsert', key: 'trip_test' }),
    ]);
    expect(roundTrip(before, after).trip).toEqual(after.trip);
  });

  it('keys travelModeOverrides by segmentKey', () => {
    const base = trip([], [{ segmentKey: 's1', mode: 'DRIVE' }]);
    const next = trip([], [{ segmentKey: 's1', mode: 'WALK' }]);
    const changes = diffTripData(base, next, base, META);
    expect(changes).toMatchObject([{ collection: 'travelModeOverrides', op: 'upsert', key: 's1' }]);
  });
});

describe('replayChanges', () => {
  const a = act('a', 'Kayak');
  const b = act('b', 'Hike');
  const c = act('c', 'Dinner');
  const baseline = trip([a, b, c]);

  it.each([
    ['edit', trip([a, act('b', 'Long hike'), c])],
    ['delete', trip([a, c])],
    ['append', trip([a, b, c, act('d', 'Museum')])],
    ['reorder', trip([c, a, b])],
    ['insert in middle', trip([a, act('d', 'Museum'), b, c])],
    ['delete + reorder + add', trip([act('d', 'Museum'), c, a])],
  ])('round-trips a %s', (_label, next) => {
    expect(roundTrip(baseline, next)).toEqual(next);
  });

  it('round-trips a sequence of separate edits', () => {
    const step1 = trip([a, act('b', 'Long hike'), c]);
    const step2 = trip([c, a, act('b', 'Long hike')]);
    const changes = [
      ...diffTripData(baseline, step1, baseline, META),
      ...diffTripData(step1, step2, baseline, { ...META, batch: 'b2' }),
    ];
    expect(replayChanges(baseline, changes).data).toEqual(step2);
  });

  it('leaves untouched collections as the same arrays', () => {
    const { data } = replayChanges(baseline, diffTripData(baseline, trip([a, c]), baseline, META));
    expect(data.notes).toBe(baseline.notes);
    expect(data.routes).toBe(baseline.routes);
  });

  it('keeps entities the shipped JSON gained after a reorder, after the ordered ones', () => {
    const changes = diffTripData(baseline, trip([c, b, a]), baseline, META);
    const newerBaseline = trip([a, b, c, act('z', 'Shipped later')]);
    expect(ids(replayChanges(newerBaseline, changes).data)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('keeps local edits while the shipped JSON is unchanged', () => {
    const changes = diffTripData(baseline, trip([a, act('b', 'Long hike'), c]), baseline, META);
    expect(replayChanges(baseline, changes).kept).toEqual(changes);
  });

  describe('when the shipped JSON changed under a local edit', () => {
    const local = act('b', 'Long hike');
    const changes: Change[] = diffTripData(baseline, trip([a, local, c]), baseline, META);

    it('drops the edit once it has landed in the shipped JSON', () => {
      const { data, kept } = replayChanges(trip([a, { ...local }, c]), changes);
      expect(data.activities[1]).toEqual(local);
      expect(kept).toEqual([]);
    });

    it('shows the shipped version when it differs from the local edit', () => {
      const shippedB = act('b', 'Hike (updated upstream)');
      const { data, kept } = replayChanges(trip([a, shippedB, c]), changes);
      expect(data.activities[1]).toEqual(shippedB);
      expect(kept).toEqual([]);
    });

    it('drops every earlier change to that entity, not just the latest', () => {
      const step1 = trip([a, local, c]);
      const twice = [
        ...changes,
        ...diffTripData(step1, trip([a, act('b', 'Longer hike'), c]), baseline, {
          ...META,
          batch: 'b2',
        }),
      ];
      expect(replayChanges(trip([a, act('b', 'Upstream'), c]), twice).kept).toEqual([]);
    });

    it('leaves local changes to other entities alone', () => {
      const other = act('c', 'Late dinner');
      const both = diffTripData(baseline, trip([a, local, other]), baseline, META);
      const { data, kept } = replayChanges(trip([a, act('b', 'Upstream'), c]), both);
      expect(data.activities[2]).toEqual(other);
      expect(kept).toHaveLength(1);
    });

    it('drops a local addition once the shipped JSON has it too', () => {
      const d = act('d', 'Museum');
      const added = diffTripData(baseline, trip([a, b, c, d]), baseline, META);
      expect(replayChanges(trip([a, b, c, d]), added).kept).toEqual([]);
    });

    it('drops a local deletion once the shipped JSON has removed it too', () => {
      const deletion = diffTripData(baseline, trip([a, c]), baseline, META);
      const { data, kept } = replayChanges(trip([a, c]), deletion);
      expect(ids(data)).toEqual(['a', 'c']);
      expect(kept).toEqual([]);
    });
  });
});

describe('changedCollections', () => {
  it('lists each collection with at least one change', () => {
    const base = trip([act('a', 'Kayak')], [{ segmentKey: 's1', mode: 'DRIVE' }]);
    const next = trip([], [{ segmentKey: 's1', mode: 'WALK' }]);
    expect(changedCollections(diffTripData(base, next, base, META))).toEqual(
      new Set(['activities', 'travelModeOverrides']),
    );
  });
});
