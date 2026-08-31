import { describe, expect, it } from 'vitest';

import {
  applyActivityReorder,
  applyBlockReorder,
  applyGroupActivityReorder,
  applyTransitReorder,
  buildDragMeta,
  type DragMeta,
  resolveDropTiming,
} from './reorder';
import type {
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  ScenarioTrack,
  SequenceItem,
  TripData,
} from './types';

const DAY_START = '2027-06-01T00:00';

// Returns an EnrichedActivity (a superset of Activity) so the same fixture
// works both as a raw TripData.activities entry and inside a
// SectionSequenceItem, which is typed against the enriched shape.
function activity(overrides: Partial<EnrichedActivity>): EnrichedActivity {
  return {
    _id: 'act1',
    legId: 'legA',
    scenarioId: null,
    status: 'planning',
    startAt: null,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
    text: 'Test activity',
    place: null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    notes: [],
    hasWarningNote: false,
    transitOverlapWarning: null,
    activityOverlapWarning: null,
    ...overrides,
  };
}

// Returns an EnrichedTransit, shared by every describe block below that
// needs a Transit fixture (applyTransitReorder, applyBlockReorder) —
// mirrors activity()'s own module-scope convention rather than each block
// keeping its own copy.
function transit(overrides: Partial<EnrichedTransit>): EnrichedTransit {
  return {
    _id: 'transit1',
    legId: 'legA',
    journeyId: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: 'A' },
    to: { id: null, label: 'B' },
    departsAt: '2027-06-01T08:00',
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
    routeInfo: null,
    arrivesAt: '2027-06-01T09:30',
    notes: [],
    hasWarningNote: false,
    ...overrides,
  };
}

describe('resolveDropTiming', () => {
  it('anchors exactly at the preceding item', () => {
    expect(resolveDropTiming('2027-06-01T12:00', DAY_START, '2027-06-01T08:00')).toEqual({
      startAt: '2027-06-01T12:00',
    });
  });

  it('keeps the dragged Activity’s own time when the drop has no real anchor', () => {
    expect(resolveDropTiming(null, DAY_START, '2027-06-01T08:00')).toEqual({
      startAt: '2027-06-01T08:00',
    });
  });

  it('falls back to the container day start only when the Activity has no time of its own either', () => {
    expect(resolveDropTiming(null, DAY_START, null)).toEqual({ startAt: DAY_START });
  });

  // The empty-target-day bug: dropping onto a day with nothing scheduled
  // yet has no real anchor (precedingEndAt is null) — but unlike a same-day
  // "no real anchor" drop, this still has to relocate the Activity onto the
  // new date, not silently strand it on its old one.
  it('re-bases a real ownStartAt onto the destination day when the drop crosses days, keeping its own time-of-day', () => {
    expect(resolveDropTiming(null, '2027-07-13T00:00', '2027-06-01T08:00', true)).toEqual({
      startAt: '2027-07-13T08:00',
    });
  });

  it('falls back to the destination day start for a crossing drop when the Activity has no time of its own either', () => {
    expect(resolveDropTiming(null, '2027-07-13T00:00', null, true)).toEqual({
      startAt: '2027-07-13T00:00',
    });
  });

  it('still prefers a real preceding anchor over re-basing, even when the drop crosses days', () => {
    expect(
      resolveDropTiming('2027-07-13T09:00', '2027-07-13T00:00', '2027-06-01T08:00', true),
    ).toEqual({ startAt: '2027-07-13T09:00' });
  });
});

describe('buildDragMeta', () => {
  it('anchors exactly on an instantaneous Transit boundary’s own key, with no anchorEntityId', () => {
    // No nudge needed: mergeByTime's own tie-break (stays-then-transits-
    // then-activities array order) already resolves an exact tie in favor
    // of the Transit sorting first, for free.
    const t = transit({});
    const flattened: SequenceItem[] = [
      { type: 'transit-boundary', transit: t, phase: 'arrive', key: '2027-06-01T09:30' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    expect(dragMeta[0].endAt).toBe('2027-06-01T09:30');
    expect(dragMeta[0].anchorEntityId).toBeNull();
  });

  it('anchors exactly on a non-meal Activity’s own startAt when it has no duration, and names it as anchorEntityId', () => {
    const flattened: SequenceItem[] = [
      { type: 'section', activities: [activity({ _id: 'act1', startAt: '2027-06-01T10:00' })] },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    expect(dragMeta[0].endAt).toBe('2027-06-01T10:00');
    expect(dragMeta[0].anchorEntityId).toEqual({ kind: 'activity', id: 'act1' });
  });

  it('uses an explicit durationMinutes as the anchor end, with no extra cushion', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [activity({ startAt: '2027-06-01T09:00', durationMinutes: 60 })],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    expect(dragMeta[0].endAt).toBe('2027-06-01T10:00');
  });

  it("uses a meal's estimated duration as its anchor end, with no extra cushion", () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({
            startAt: '2027-06-01T10:15',
            mealType: 'dinner',
            diningFormat: 'sit-down',
          }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    // 'sit-down' -> 60 minutes, tripModel.ts's DEFAULT_MEAL_DURATION_MINUTES.
    expect(dragMeta[0].endAt).toBe('2027-06-01T11:15');
  });

  it('only the Depart boundary carries a transitId — Arrive does not', () => {
    const t = transit({});
    const flattened: SequenceItem[] = [
      { type: 'transit-boundary', transit: t, phase: 'depart', key: '2027-06-01T08:00' },
      { type: 'transit-boundary', transit: t, phase: 'arrive', key: '2027-06-01T09:30' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const depart = dragMeta.find((d) => d.id === 'transit-transit1-depart')!;
    const arrive = dragMeta.find((d) => d.id === 'transit-transit1-arrive')!;
    expect(depart.transitId).toBe('transit1');
    expect(arrive.transitId).toBeFalsy();
  });

  it('gives the scenario-tabs row a scenarioGroup naming every Activity/Transit across every branch, including nested children, deduplicating a Transit named by more than one of its own rows', () => {
    const idealTransit = transit({
      _id: 'idealTransit',
      scenarioId: 'ideal',
      arrivesAt: '2027-06-01T09:00',
    });
    const tracks: ScenarioTrack[] = [
      {
        scenario: {
          _id: 'ideal',
          legId: 'legA',
          tone: 'ideal',
          label: 'Ideal',
          icon: 'sunny',
          images: [],
        },
        notes: [],
        anchorKey: '2027-06-01T08:00',
        realAnchorKey: '2027-06-01T08:00',
        sequence: [
          {
            type: 'transit-boundary',
            transit: idealTransit,
            phase: 'depart',
            key: '2027-06-01T08:00',
          },
          // Same transit, second row (its own Arrive boundary) — names the
          // same idealTransit._id a second time, so the assertion below on
          // transitIds' length actually exercises collectScenarioGroupMembers'
          // Set-based dedup rather than trivially passing with only one
          // reference to begin with.
          {
            type: 'transit-boundary',
            transit: idealTransit,
            phase: 'arrive',
            key: '2027-06-01T09:00',
          },
          {
            type: 'section',
            activities: [
              activity({ _id: 'idealAct', scenarioId: 'ideal', startAt: '2027-06-01T10:00' }),
            ],
          },
        ],
      },
      {
        scenario: {
          _id: 'alt',
          legId: 'legA',
          tone: 'alternate',
          label: 'Alt',
          icon: 'rainy',
          images: [],
        },
        notes: [],
        anchorKey: '2027-06-01T08:00',
        realAnchorKey: '2027-06-01T08:00',
        sequence: [
          {
            type: 'section',
            activities: [
              activity({ _id: 'altAct', scenarioId: 'alt', startAt: '2027-06-01T09:00' }),
            ],
          },
          {
            type: 'scenario-tabs',
            key: '2027-06-01T13:00',
            tracks: [
              {
                scenario: {
                  _id: 'nested',
                  legId: 'legA',
                  tone: 'alternate',
                  label: 'Nested',
                  icon: 'cloud',
                  images: [],
                  parentScenarioId: 'alt',
                },
                notes: [],
                anchorKey: '2027-06-01T13:00',
                realAnchorKey: '2027-06-01T13:00',
                sequence: [
                  {
                    type: 'section',
                    activities: [
                      activity({
                        _id: 'nestedAct',
                        scenarioId: 'nested',
                        startAt: '2027-06-01T13:00',
                      }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const flattened: SequenceItem[] = [{ type: 'scenario-tabs', key: '2027-06-01T08:00', tracks }];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    expect(dragMeta).toHaveLength(1);
    expect(dragMeta[0].scenarioGroup?.activityIds.sort()).toEqual([
      'altAct',
      'idealAct',
      'nestedAct',
    ]);
    expect(dragMeta[0].scenarioGroup?.transitIds).toEqual(['idealTransit']);
  });

  it("falls back to the day's own scenarioTracks for a top-level scenario-tabs placeholder, which (per tripModel.ts's buildSequence) carries no tracks of its own", () => {
    const tracks: ScenarioTrack[] = [
      {
        scenario: {
          _id: 'ideal',
          legId: 'legA',
          tone: 'ideal',
          label: 'Ideal',
          icon: 'sunny',
          images: [],
        },
        notes: [],
        anchorKey: '2027-06-01T08:00',
        realAnchorKey: '2027-06-01T08:00',
        sequence: [
          {
            type: 'section',
            activities: [
              activity({ _id: 'idealAct', scenarioId: 'ideal', startAt: '2027-06-01T08:00' }),
            ],
          },
        ],
      },
    ];
    const flattened: SequenceItem[] = [{ type: 'scenario-tabs', key: '2027-06-01T08:00' }];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA', tracks);
    expect(dragMeta).toHaveLength(1);
    expect(dragMeta[0].scenarioGroup?.activityIds).toEqual(['idealAct']);
  });

  it('gives a scenario-tabs row a dragId unique per calendar day, not just per local row index, since every DayTimeline instance shares one DndContext', () => {
    // Two different days, each with a scenario-tabs item sitting at local
    // index 0 of its own flattened array — the same shape the real trip
    // data hits on 2027-07-10/11/12, where every day's own scenario-tabs
    // group used to collide on the identical id `scenario-tabs-0`.
    const dayOne = buildDragMeta(
      [{ type: 'scenario-tabs', key: '2027-06-01T08:00', tracks: [] }],
      null,
      '2027-06-01T00:00',
      'legA',
    );
    const dayTwo = buildDragMeta(
      [{ type: 'scenario-tabs', key: '2027-06-02T08:00', tracks: [] }],
      null,
      '2027-06-02T00:00',
      'legA',
    );
    expect(dayOne[0].id).not.toBe(dayTwo[0].id);
  });

  it('gives two scenario-tabs rows on the SAME day distinct dragIds — a top-level group and a nested scenario tab’s own sub-group', () => {
    // Both at local index 0 of their own respective flattened arrays (one
    // top-level, scenarioId null; one inside a scenario tab, a real
    // scenarioId) — date alone isn't enough to disambiguate these two.
    const topLevel = buildDragMeta(
      [{ type: 'scenario-tabs', key: '2027-06-01T08:00', tracks: [] }],
      null,
      DAY_START,
      'legA',
    );
    const nested = buildDragMeta(
      [{ type: 'scenario-tabs', key: '2027-06-01T08:00', tracks: [] }],
      'scenario_jul1_alt',
      DAY_START,
      'legA',
    );
    expect(topLevel[0].id).not.toBe(nested[0].id);
  });
});

function enrichedStay(overrides: Partial<EnrichedStay>): EnrichedStay {
  return {
    _id: 'stay1',
    legId: 'legA',
    checkInAt: '2027-06-01T20:00',
    checkOutAt: '2027-06-01T11:00',
    status: 'planning',
    lodging: null,
    booking: null,
    images: [],
    notes: [],
    hasWarningNote: false,
    ...overrides,
  };
}

describe('Stay Check-out/Check-in drop targets', () => {
  // Check-out/Check-in always render first/last in the day (see
  // tripModel.ts's splitOutStayBoundaries) regardless of their own clock
  // time, so their own checkOutAt/checkInAt isn't what a drop there should
  // anchor to.
  it('Check-out anchors to the day’s previously-first Activity, not its own checkOutAt', () => {
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Check out', key: '2027-06-01T11:00' },
      {
        type: 'section',
        activities: [
          activity({ _id: 'act1', startAt: '2027-06-01T09:00', durationMinutes: 30 }),
          activity({ _id: 'act2', startAt: '2027-06-01T11:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const checkout = dragMeta.find((d) => d.kind === 'day-start');
    expect(checkout?.endAt).toBe('2027-06-01T09:00');
    expect(checkout?.cascadeActivityIds).toEqual(['act1', 'act2']);
  });

  it('dropping an Activity onto Check-out takes over the old-first time, shifts the rest later, and leaves durationMinutes untouched', () => {
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Check out', key: '2027-06-01T11:00' },
      {
        type: 'section',
        activities: [
          activity({ _id: 'act1', startAt: '2027-06-01T09:00', durationMinutes: 30 }),
          activity({ _id: 'act2', startAt: '2027-06-01T11:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const checkout = dragMeta.find((d) => d.kind === 'day-start')!;

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'act1', startAt: '2027-06-01T09:00', durationMinutes: 30 }),
        activity({ _id: 'act2', startAt: '2027-06-01T11:00' }),
        activity({ _id: 'act3', startAt: '2027-06-01T15:00', durationMinutes: 20 }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, checkout, 'act3', DAY_START);
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('act3')).toMatchObject({ startAt: '2027-06-01T09:00', durationMinutes: 20 });
    expect(byId('act1')).toMatchObject({ startAt: '2027-06-01T09:20', durationMinutes: 30 });
    expect(byId('act2')).toMatchObject({ startAt: '2027-06-01T11:20', durationMinutes: null });
  });

  it('shifts the rest by a nominal one minute when the dragged Activity has no duration of its own', () => {
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Check out', key: '2027-06-01T11:00' },
      { type: 'section', activities: [activity({ _id: 'act1', startAt: '2027-06-01T09:00' })] },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const checkout = dragMeta.find((d) => d.kind === 'day-start')!;

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'act1', startAt: '2027-06-01T09:00' }),
        activity({ _id: 'act4' }), // fuzzy, no startAt/duration
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, checkout, 'act4', DAY_START);
    expect(next.activities.find((a) => a._id === 'act1')?.startAt).toBe('2027-06-01T09:01');
  });

  it('Check-in anchors to the day’s real last Activity/Transit, not its own checkInAt', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({ _id: 'act1', startAt: '2027-06-01T09:00', durationMinutes: 30 }),
          activity({ _id: 'act2', startAt: '2027-06-01T11:00' }), // no duration -> own startAt
        ],
      },
      // checkInAt (20:00) is much later than the day's real last Activity —
      // the anchor should still come from that Activity, not checkInAt.
      { type: 'stay', stay: enrichedStay({}), relation: 'Check in', key: '2027-06-01T20:00' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const checkin = dragMeta.find((d) => d.id.startsWith('stay-'))!;
    expect(checkin.kind).toBe('after');
    expect(checkin.endAt).toBe('2027-06-01T11:00');
    // Names the real last Activity as the tie-break anchor, even though
    // this DragMeta's own activityId is null (the Check-in row itself
    // isn't draggable).
    expect(checkin.anchorEntityId).toEqual({ kind: 'activity', id: 'act2' });
  });

  it('Check-out on a day with no real top-level content has a null endAt, and a drop there keeps the dragged Activity’s own time', () => {
    // Everything on this day lives inside a Scenario (excluded from
    // realAnchors) — Check-out has nothing real to take a time from.
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Check out', key: '2027-06-01T11:00' },
      { type: 'scenario-tabs', key: '2027-06-01T08:00' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const checkout = dragMeta.find((d) => d.kind === 'day-start')!;
    expect(checkout.endAt).toBeNull();
    expect(checkout.cascadeActivityIds).toEqual([]);

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [activity({ _id: 'act1', startAt: '2027-06-01T08:00', scenarioId: 'scenario1' })],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyActivityReorder(data, checkout, 'act1', DAY_START);
    const moved = next.activities.find((a) => a._id === 'act1');
    expect(moved?.startAt).toBe('2027-06-01T08:00');
    expect(moved?.scenarioId).toBeNull();
  });

  it('a mid-stay "Staying" row has a null endAt (its own key is only ever the synthetic day start)', () => {
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Staying', key: DAY_START },
      { type: 'scenario-tabs', key: '2027-06-01T08:00' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const staying = dragMeta.find((d) => d.id.startsWith('stay-'))!;
    expect(staying.kind).toBe('after');
    expect(staying.endAt).toBeNull();
  });

  it('gives a Stay row a dragId unique per calendar day, not just per local row index, since a multi-night Stay renders one row per night under one shared DndContext', () => {
    const stay = enrichedStay({});
    const nightOne = buildDragMeta(
      [{ type: 'stay', stay, relation: 'Staying', key: '2027-06-01T00:00' }],
      null,
      '2027-06-01T00:00',
      'legA',
    );
    const checkOutDay = buildDragMeta(
      [{ type: 'stay', stay, relation: 'Check out', key: '2027-06-02T11:00' }],
      null,
      '2027-06-02T00:00',
      'legA',
    );
    expect(nightOne[0].id).not.toBe(checkOutDay[0].id);
    expect(nightOne[0].containerDayStart).toBe('2027-06-01T00:00');
    expect(checkOutDay[0].containerDayStart).toBe('2027-06-02T00:00');
  });

  it('lands a dropped Activity exactly on its anchor’s own instant, then resolves the tie by array position rather than nudging either timestamp', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({ _id: 'act1', startAt: '2027-06-01T09:00' }), // no duration -> own startAt
          activity({ _id: 'act2', startAt: '2027-06-01T11:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    const act1Anchor = dragMeta.find(
      (d) => d.anchorEntityId?.kind === 'activity' && d.anchorEntityId.id === 'act1',
    )!;
    expect(act1Anchor.endAt).toBe('2027-06-01T09:00');

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'act1', startAt: '2027-06-01T09:00' }),
        activity({ _id: 'act2', startAt: '2027-06-01T11:00' }),
        activity({ _id: 'act3', startAt: '2027-06-01T15:00' }), // the one being dragged
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, act1Anchor, 'act3', DAY_START);
    const act3 = next.activities.find((a) => a._id === 'act3');
    // A genuine tie: act3 now starts at the exact same instant as act1.
    expect(act3?.startAt).toBe('2027-06-01T09:00');
    // Resolved by array order, not a fake time gap: act3 sits immediately
    // after act1 (its anchor), so day.sequence's stable sort places it
    // right after act1 despite the tie.
    const ids = next.activities.map((a) => a._id);
    expect(ids.indexOf('act3')).toBe(ids.indexOf('act1') + 1);
  });
});

describe('applyActivityReorder', () => {
  it('rewrites legId/scenarioId to match a leg-transition drop position', () => {
    const arrivingTransit: EnrichedTransit = {
      _id: 'transit1',
      legId: 'legB',
      journeyId: null,
      scenarioId: null,
      status: 'planning',
      mode: 'drive',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      departsAt: '2027-06-01T08:00',
      routeId: null,
      routeVariant: null,
      booking: null,
      images: [],
      routeInfo: null,
      arrivesAt: '2027-06-01T09:30',
      notes: [],
      hasWarningNote: false,
    };
    const flattened: SequenceItem[] = [
      {
        type: 'transit-boundary',
        transit: arrivingTransit,
        phase: 'arrive',
        key: '2027-06-01T09:30',
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
    expect(dragMeta).toHaveLength(1);

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [activity({ legId: 'legA', scenarioId: 'sc1' })],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, dragMeta[0], 'act1', DAY_START);
    const updated = next.activities.find((a) => a._id === 'act1');
    expect(updated?.legId).toBe('legB');
    expect(updated?.scenarioId).toBeNull();
    expect(updated?.startAt).toBe('2027-06-01T09:30');
  });

  // The Denali-flightseeing scenario: dragging a 2-hour Activity to take
  // over an earlier, no-duration Activity's own slot should push that
  // Activity later by exactly the overlap, and stop there — a further
  // downstream Activity that already starts well clear of the new time
  // needs no adjustment at all.
  it('a mid-day "after" drop cascades only the overlap it creates, stopping at the first Activity that already has room', () => {
    const arrivingTransit: EnrichedTransit = {
      _id: 'transit1',
      legId: 'legA',
      journeyId: null,
      scenarioId: null,
      status: 'planning',
      mode: 'flight',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      departsAt: '2027-06-27T08:00',
      routeId: null,
      routeVariant: null,
      booking: null,
      images: [],
      routeInfo: null,
      arrivesAt: '2027-06-27T09:00',
      notes: [],
      hasWarningNote: false,
    };
    const flattened: SequenceItem[] = [
      {
        type: 'transit-boundary',
        transit: arrivingTransit,
        phase: 'arrive',
        key: '2027-06-27T09:00',
      },
      {
        type: 'section',
        activities: [
          activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
          activity({ _id: 'westrib', startAt: '2027-06-27T15:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T09:00', 'legA');
    const arrivalAnchor = dragMeta.find((d) => d.id === 'transit-transit1-arrive')!;
    expect(arrivalAnchor.cascadeActivityIds).toEqual(['checkin', 'westrib']);

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
        activity({ _id: 'westrib', startAt: '2027-06-27T15:00' }),
        activity({ _id: 'flightseeing', startAt: '2027-06-27T09:30', durationMinutes: 120 }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, arrivalAnchor, 'flightseeing', '2027-06-27T09:00');
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('flightseeing')?.startAt).toBe('2027-06-27T09:00');
    expect(byId('checkin')?.startAt).toBe('2027-06-27T11:00');
    expect(byId('westrib')?.startAt).toBe('2027-06-27T15:00'); // untouched — no overlap
  });

  // The exact reported bug: dragging Flightseeing upward onto Check-in —
  // Check-in being the day's very first real anchor, with nothing before it
  // to anchor an ordinary "insert after" placement to. dnd-kit's own `over`
  // still just names Check-in's row regardless of drag direction, so
  // DaysView.tsx's own index comparison (dragged Activity's original index
  // vs. the row dropped onto) is what has to pick Check-in's `before`
  // field over its plain fields — reproduced here directly rather than via
  // DaysView.tsx, which isn't unit-tested.
  it('dragging an Activity upward onto an earlier one takes over its slot and pushes it later, stopping at the first Activity with room', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
          activity({ _id: 'flightseeing', startAt: '2027-06-27T09:30', durationMinutes: 120 }),
          activity({ _id: 'westrib', startAt: '2027-06-27T12:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T00:00', 'legA');
    const checkinMeta = dragMeta.find((d) => d.activityId === 'checkin')!;
    const flightseeingMeta = dragMeta.find((d) => d.activityId === 'flightseeing')!;
    expect(checkinMeta.before?.endAt).toBe('2027-06-27T09:00');
    expect(checkinMeta.before?.cascadeActivityIds).toEqual(['checkin', 'flightseeing', 'westrib']);
    // Flightseeing's own index is later than Check-in's — the condition
    // DaysView.tsx reads as "this drag moved the row upward."
    expect(flightseeingMeta.index).toBeGreaterThan(checkinMeta.index);

    const dropMeta: DragMeta = { ...checkinMeta, ...checkinMeta.before };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
        activity({ _id: 'flightseeing', startAt: '2027-06-27T09:30', durationMinutes: 120 }),
        activity({ _id: 'westrib', startAt: '2027-06-27T12:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, dropMeta, 'flightseeing', '2027-06-27T00:00');
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('flightseeing')?.startAt).toBe('2027-06-27T09:00');
    expect(byId('checkin')?.startAt).toBe('2027-06-27T11:00');
    expect(byId('westrib')?.startAt).toBe('2027-06-27T12:00'); // untouched — no overlap
  });

  // The Homer-Spit bug: dragging a duration-less Activity upward onto the
  // day's very first real anchor used to force it to take over that
  // anchor's exact startAt even though it had no duration to lend — with
  // nothing genuinely displaced, that was just an unrequested time change.
  // A drag onto the front of a container should still move legId/scenarioId
  // (and array position for tie-break purposes) without touching a
  // duration-less Activity's own time at all.
  it('dragging a duration-less Activity onto the front of a container leaves its own time untouched', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({ _id: 'drive', startAt: '2027-07-13T06:00' }),
          activity({ _id: 'explore', startAt: '2027-07-13T10:45' }),
          activity({ _id: 'lunch', startAt: '2027-07-13T12:00' }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, '2027-07-13T00:00', 'legA');
    const driveMeta = dragMeta.find((d) => d.activityId === 'drive')!;
    expect(driveMeta.before?.kind).toBe('front-takeover');
    expect(driveMeta.before?.endAt).toBe('2027-07-13T06:00');

    const dropMeta: DragMeta = { ...driveMeta, ...driveMeta.before };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'drive', startAt: '2027-07-13T06:00' }),
        activity({ _id: 'explore', startAt: '2027-07-13T10:45', scenarioId: 'bonus' }),
        activity({ _id: 'lunch', startAt: '2027-07-13T12:00', scenarioId: 'bonus' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, dropMeta, 'explore', '2027-07-13T00:00');
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('explore')?.startAt).toBe('2027-07-13T10:45'); // unchanged
    expect(byId('explore')?.scenarioId).toBeNull(); // still moves out of the scenario
    expect(byId('drive')?.startAt).toBe('2027-07-13T06:00'); // untouched, no cascade
    expect(byId('lunch')?.startAt).toBe('2027-07-13T12:00'); // untouched, no cascade
  });

  // The same front-of-container drop still forces a takeover when the
  // dragged Activity genuinely has duration to occupy the slot with — this
  // is exactly the pre-existing checkin/flightseeing precedent, just phrased
  // against the new 'front-takeover' kind rather than the old unconditional
  // rule, to pin down that this fix didn't regress it.
  it('still forces a takeover onto the front of a container when the dragged Activity has real duration', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [
          activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
          activity({ _id: 'flightseeing', startAt: '2027-06-27T09:30', durationMinutes: 120 }),
        ],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T00:00', 'legA');
    const checkinMeta = dragMeta.find((d) => d.activityId === 'checkin')!;
    expect(checkinMeta.before?.kind).toBe('front-takeover');

    const dropMeta: DragMeta = { ...checkinMeta, ...checkinMeta.before };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'checkin', startAt: '2027-06-27T09:00' }),
        activity({ _id: 'flightseeing', startAt: '2027-06-27T09:30', durationMinutes: 120 }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, dropMeta, 'flightseeing', '2027-06-27T00:00');
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('flightseeing')?.startAt).toBe('2027-06-27T09:00');
    expect(byId('checkin')?.startAt).toBe('2027-06-27T11:00');
  });

  // DayTimeline's own EmptyDropZone (a freshly-added, still-empty Scenario's
  // "Nothing here yet — drag an activity in" placeholder) builds exactly
  // this DragMeta shape — no real anchor to take a time from (endAt: null,
  // same convention as a mid-stay "Staying" row), just a scenarioId/legId to
  // hand the dropped Activity. Mirrors the "Check-out on a day with no real
  // top-level content" case above, just assigning a scenarioId instead of
  // clearing one.
  it('dropping an Activity onto an empty scenario’s own drop zone assigns its scenarioId/legId, keeping its own time', () => {
    const emptyZoneMeta: DragMeta = {
      id: 'empty-2027-06-01::scenario-new',
      index: 0,
      endAt: null,
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: 'scenario-new',
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [activity({ _id: 'act1', legId: 'legA', startAt: '2027-06-01T08:00' })],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, emptyZoneMeta, 'act1', DAY_START, true);
    const moved = next.activities.find((a) => a._id === 'act1');
    expect(moved?.scenarioId).toBe('scenario-new');
    expect(moved?.legId).toBe('legB');
    expect(moved?.startAt).toBe('2027-06-01T08:00'); // untouched — no real anchor to take a time from
  });

  // The reported empty-target-day bug: DayTimeline's own EmptyDropZone
  // builds exactly this shape for a day with nothing scheduled on it at all
  // (endAt: null, same as the empty-scenario case above) — but unlike that
  // case, this drop is landing on a genuinely different calendar day, not
  // just a different container on the same day. `preserveOwnTiming` is
  // false here (DaysView.tsx only ever sets it for a same-day container
  // crossing), so this has to fall through to resolveDropTiming's own
  // crossesDay re-basing rather than leaving the Activity stranded on its
  // old date.
  it('dropping an Activity onto a genuinely empty destination day still relocates it onto that day', () => {
    const emptyDayMeta: DragMeta = {
      id: 'empty-2027-07-13',
      index: 0,
      endAt: null,
      containerDayStart: '2027-07-13T00:00',
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'act1', legId: 'legA', startAt: '2027-06-01T08:00', durationMinutes: 30 }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyActivityReorder(data, emptyDayMeta, 'act1', '2027-07-13T00:00');
    const moved = next.activities.find((a) => a._id === 'act1');
    expect(moved?.legId).toBe('legB');
    // Relocated onto the destination day, keeping its original time-of-day.
    expect(moved?.startAt).toBe('2027-07-13T08:00');
  });

  // The actual Homer-Spit bug: dragging an Activity out of a scenario tab
  // into the top-level day list (or between two scenario tabs) is a
  // cross-container drag — DragMeta's own `index`/`before` are only
  // meaningful within the single buildDragMeta call that produced them, so
  // whatever row dnd-kit's `over` names in the *other* container is not a
  // legitimate "insert after this exact instant" anchor. DaysView.tsx
  // detects this via dnd-kit's own sortable.containerId and passes
  // `crossContainer: true` — this should leave the dragged Activity's own
  // time completely untouched, only moving its legId/scenarioId.
  it('a cross-container drop never forces a time takeover, regardless of the anchor it lands near', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [activity({ _id: 'drive', startAt: '2027-07-13T06:00' })],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, '2027-07-13T00:00', 'legA');
    const driveMeta = dragMeta.find((d) => d.activityId === 'drive')!;

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'drive', startAt: '2027-07-13T06:00' }),
        activity({ _id: 'explore', startAt: '2027-07-13T10:45', scenarioId: 'bonus' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    // Dragged from inside a scenario tab, dropped directly onto 'drive' in
    // the top-level container — the same plain DragMeta a same-container
    // "insert after this row" drop would use, but flagged cross-container.
    const next = applyActivityReorder(data, driveMeta, 'explore', '2027-07-13T00:00', true);
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    expect(byId('explore')?.startAt).toBe('2027-07-13T10:45'); // unchanged
    expect(byId('explore')?.scenarioId).toBeNull(); // still moves out of the scenario
    expect(byId('drive')?.startAt).toBe('2027-07-13T06:00'); // untouched, no cascade
  });
});

describe('applyTransitReorder', () => {
  it('shifts arrivesAt by the same delta as departsAt for an unrouted Transit, preserving its duration', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    // Original duration was 90 minutes (08:00 -> 09:30); dropped at 12:00 ->
    // arrivesAt must land at 13:30 to preserve it.
    expect(moved?.departsAt).toBe('2027-06-01T12:00');
    expect(moved?.arrivesAt).toBe('2027-06-01T13:30');
  });

  it('leaves arrivesAt alone for a routed Transit - buildTripView recomputes it from the new departsAt', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ routeId: 'route1', arrivesAt: null })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-06-01T12:00');
    expect(moved?.arrivesAt).toBeNull();
  });

  it('reassigns legId and scenarioId to the drop target', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: 'scenario1',
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ legId: 'legA', scenarioId: null })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.legId).toBe('legB');
    expect(moved?.scenarioId).toBe('scenario1');
  });

  it('rebases onto the destination day, keeping time-of-day, on a cross-day drop with no real anchor', () => {
    const dropMeta: DragMeta = {
      id: 'empty-2027-07-13',
      index: 0,
      endAt: null,
      containerDayStart: '2027-07-13T00:00',
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ departsAt: '2027-06-01T08:00', arrivesAt: '2027-06-01T09:30' })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', '2027-07-13T00:00');
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-07-13T08:00');
    expect(moved?.arrivesAt).toBe('2027-07-13T09:30');
  });

  it("a same-day cross-container drop preserves the Transit's own timing when preserveOwnTiming is set", () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T15:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: 'scenario2',
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START, true);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-06-01T08:00'); // untouched
    expect(moved?.arrivesAt).toBe('2027-06-01T09:30'); // untouched
    expect(moved?.scenarioId).toBe('scenario2'); // still reassigned
  });

  it('repositions the Transit in data.transits right after anchorEntityId when it names another transit', () => {
    const dropMeta: DragMeta = {
      id: 'transit-transit2-arrive',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: { kind: 'transit', id: 'transit2' },
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [
        transit({ _id: 'transit1' }),
        transit({ _id: 'transit2', departsAt: '2027-06-01T10:00', arrivesAt: '2027-06-01T11:00' }),
      ],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const ids = next.transits.map((t) => t._id);
    expect(ids.indexOf('transit1')).toBe(ids.indexOf('transit2') + 1);
  });
});

describe('applyBlockReorder', () => {
  it("shifts every member by the same delta, computed from the block's earliest member", () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00', // the block's earliest member (transit1, 08:00) lands here
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ scenarioId: 'ideal', arrivesAt: '2027-06-01T09:00' })],
      activities: [
        activity({ _id: 'idealAct', scenarioId: 'ideal', startAt: '2027-06-01T10:00' }),
        activity({ _id: 'altAct', scenarioId: 'alt', startAt: '2027-06-01T09:00' }),
        activity({ _id: 'bystander', scenarioId: null, startAt: '2027-06-01T20:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'altAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    const transitById = next.transits.find((t) => t._id === 'transit1');
    // delta = 10:00 - 08:00 = +120 minutes, applied to every member.
    expect(transitById?.departsAt).toBe('2027-06-01T10:00');
    expect(transitById?.arrivesAt).toBe('2027-06-01T11:00'); // duration preserved
    expect(byId('idealAct')?.startAt).toBe('2027-06-01T12:00');
    expect(byId('altAct')?.startAt).toBe('2027-06-01T11:00');
    expect(byId('bystander')?.startAt).toBe('2027-06-01T20:00'); // untouched — not a member
  });

  it('reassigns legId for every member but never touches scenarioId', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ legId: 'legA' })],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const moved = next.activities.find((a) => a._id === 'idealAct');
    const movedTransit = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.legId).toBe('legB');
    expect(moved?.scenarioId).toBe('ideal'); // untouched
    expect(movedTransit?.legId).toBe('legB');
  });

  it('reassigns legId even for a member with no real startAt to shift', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
        activity({
          _id: 'fuzzyAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: null,
          timeLabel: 'Sometime',
        }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'fuzzyAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const fuzzy = next.activities.find((a) => a._id === 'fuzzyAct');
    expect(fuzzy?.legId).toBe('legB');
    expect(fuzzy?.startAt).toBeNull(); // no time to shift, but legId still moves
  });

  it('still reassigns legId for every member when the WHOLE block is fuzzy Activities with zero Transits — no real anchor time to shift from at all', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({
          _id: 'fuzzyOne',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: null,
          timeLabel: 'Sometime',
        }),
        activity({
          _id: 'fuzzyTwo',
          legId: 'legA',
          scenarioId: 'alt',
          startAt: null,
          timeLabel: 'Sometime else',
        }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['fuzzyOne', 'fuzzyTwo'], transitIds: [] },
      DAY_START,
    );
    const one = next.activities.find((a) => a._id === 'fuzzyOne');
    const two = next.activities.find((a) => a._id === 'fuzzyTwo');
    expect(one?.legId).toBe('legB');
    expect(two?.legId).toBe('legB');
    expect(one?.startAt).toBeNull(); // no time invented for either
    expect(two?.startAt).toBeNull();
    // Each keeps its own scenarioId (which branch it's in) — only legId
    // reassigns, same as every other applyBlockReorder case.
    expect(one?.scenarioId).toBe('ideal');
    expect(two?.scenarioId).toBe('alt');
  });

  it('rebases the block onto a different calendar day when dropped there', () => {
    const dropMeta: DragMeta = {
      id: 'empty-2027-07-13',
      index: 0,
      endAt: null,
      containerDayStart: '2027-07-13T00:00',
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
        activity({ _id: 'altAct', legId: 'legA', scenarioId: 'alt', startAt: '2027-06-01T09:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'altAct'], transitIds: [] },
      '2027-07-13T00:00',
    );
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    // No real anchor, but this crosses days — re-bases onto 2027-07-13,
    // keeping each member's own time-of-day and relative offset.
    expect(byId('idealAct')?.startAt).toBe('2027-07-13T08:00');
    expect(byId('altAct')?.startAt).toBe('2027-07-13T09:00');
  });
});

describe('applyGroupActivityReorder', () => {
  // A drag-handle multi-select (DayTimeline.tsx) moving two Activities at
  // once: they should land back-to-back, in the order handed in, starting
  // right at the drop anchor's own endAt — the same "insert after this
  // instant" contract a single-Activity drop already uses, just chained.
  it('lands a multi-selected group back-to-back in the given order, cascading a downstream collision only once', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T09:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: 'anchor',
      anchorEntityId: { kind: 'activity', id: 'anchor' },
      kind: 'after',
      cascadeActivityIds: ['bystander'],
    };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({ _id: 'anchor', startAt: '2027-06-01T08:00' }),
        activity({ _id: 'bystander', startAt: '2027-06-01T09:15' }),
        activity({ _id: 'g1', startAt: '2027-06-01T15:00', durationMinutes: 30 }),
        activity({ _id: 'g2', startAt: '2027-06-01T16:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyGroupActivityReorder(data, dropMeta, ['g1', 'g2'], DAY_START, () => false);
    const byId = (id: string) => next.activities.find((a) => a._id === id);

    // g1 takes over the drop anchor's own endAt; g2 chains right after g1's
    // own end (09:00 + 30min duration), not after the original anchor again.
    expect(byId('g1')?.startAt).toBe('2027-06-01T09:00');
    expect(byId('g2')?.startAt).toBe('2027-06-01T09:30');
    // The bystander only had to move once, out of g1's way — g2 lands
    // exactly where the bystander already sits after that, so a second
    // cascade pass over the same bystander is a no-op rather than a double
    // shift.
    expect(byId('bystander')?.startAt).toBe('2027-06-01T09:30');

    // Array order: both group members inserted, in order, right after their
    // shared anchor.
    const ids = next.activities.map((a) => a._id);
    expect(ids.indexOf('g1')).toBe(ids.indexOf('anchor') + 1);
    expect(ids.indexOf('g2')).toBe(ids.indexOf('g1') + 1);
  });

  // A multi-day selection (TripSelectionsContextObject.ts's ActivitySelection
  // now records each selected Activity's own origin container) can mix
  // members that are and aren't crossing into the drop's own container —
  // `shouldPreserveOwnTiming` is asked per Activity rather than once for the
  // whole group. DaysView.tsx only ever answers `true` for a *same-day*
  // container crossing (g1 here: dragged in from a scenario tab on the same
  // date, so its own time-of-day should carry over untouched, only legId/
  // scenarioId moving) — a member whose origin is a genuinely different
  // calendar day (g2: still gets `false`, same as any real cross-day member
  // would) instead takes over the position, landing right after whatever the
  // previous group member ended up at.
  it('asks shouldPreserveOwnTiming per group member, so only a same-day crossing skips the time takeover', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T09:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
      cascadeActivityIds: [],
    };

    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        // Same calendar day as the drop (2027-06-01), just a different
        // scenario container — a realistic `preserveOwnTiming: true` case.
        activity({ _id: 'g1', legId: 'legA', scenarioId: 'sc1', startAt: '2027-06-01T20:00' }),
        // A genuinely different calendar day — a realistic
        // `preserveOwnTiming: false` case, same as any cross-day member.
        activity({ _id: 'g2', legId: 'legA', startAt: '2027-06-05T15:00', durationMinutes: 30 }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };

    const next = applyGroupActivityReorder(
      data,
      dropMeta,
      ['g1', 'g2'],
      DAY_START,
      (id) => id === 'g1',
    );
    const byId = (id: string) => next.activities.find((a) => a._id === id);

    // g1's same-day crossing left its own time untouched, only legId/
    // scenarioId moved.
    expect(byId('g1')?.startAt).toBe('2027-06-01T20:00');
    expect(byId('g1')?.legId).toBe('legB');
    expect(byId('g1')?.scenarioId).toBeNull();

    // g2 crossed days: it takes over right after g1's own (untouched) start,
    // landing on the destination day rather than staying on its old date.
    expect(byId('g2')?.startAt).toBe('2027-06-01T20:00');
    expect(byId('g2')?.legId).toBe('legB');
  });
});
