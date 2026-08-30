import { describe, expect, it } from 'vitest';

import {
  applyActivityReorder,
  applyGroupActivityReorder,
  buildDragMeta,
  type DragMeta,
  resolveDropTiming,
} from './reorder';
import type {
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
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
});

describe('buildDragMeta', () => {
  it('anchors exactly on an instantaneous Transit boundary’s own key, with no anchorActivityId', () => {
    // No nudge needed: mergeByTime's own tie-break (stays-then-transits-
    // then-activities array order) already resolves an exact tie in favor
    // of the Transit sorting first, for free.
    const transit: EnrichedTransit = {
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
    };
    const flattened: SequenceItem[] = [
      { type: 'transit-boundary', transit, phase: 'arrive', key: '2027-06-01T09:30' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
    expect(dragMeta[0].endAt).toBe('2027-06-01T09:30');
    expect(dragMeta[0].anchorActivityId).toBeNull();
  });

  it('anchors exactly on a non-meal Activity’s own startAt when it has no duration, and names it as anchorActivityId', () => {
    const flattened: SequenceItem[] = [
      { type: 'section', activities: [activity({ _id: 'act1', startAt: '2027-06-01T10:00' })] },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
    expect(dragMeta[0].endAt).toBe('2027-06-01T10:00');
    expect(dragMeta[0].anchorActivityId).toBe('act1');
  });

  it('uses an explicit durationMinutes as the anchor end, with no extra cushion', () => {
    const flattened: SequenceItem[] = [
      {
        type: 'section',
        activities: [activity({ startAt: '2027-06-01T09:00', durationMinutes: 60 })],
      },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
    // 'sit-down' -> 60 minutes, tripModel.ts's DEFAULT_MEAL_DURATION_MINUTES.
    expect(dragMeta[0].endAt).toBe('2027-06-01T11:15');
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
    const checkin = dragMeta.find((d) => d.id.startsWith('stay-'))!;
    expect(checkin.kind).toBe('after');
    expect(checkin.endAt).toBe('2027-06-01T11:00');
    // Names the real last Activity as the tie-break anchor, even though
    // this DragMeta's own activityId is null (the Check-in row itself
    // isn't draggable).
    expect(checkin.anchorActivityId).toBe('act2');
  });

  it('Check-out on a day with no real top-level content has a null endAt, and a drop there keeps the dragged Activity’s own time', () => {
    // Everything on this day lives inside a Scenario (excluded from
    // realAnchors) — Check-out has nothing real to take a time from.
    const flattened: SequenceItem[] = [
      { type: 'stay', stay: enrichedStay({}), relation: 'Check out', key: '2027-06-01T11:00' },
      { type: 'scenario-tabs', key: '2027-06-01T08:00' },
    ];
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    );
    const checkOutDay = buildDragMeta(
      [{ type: 'stay', stay, relation: 'Check out', key: '2027-06-02T11:00' }],
      null,
      '2027-06-02T00:00',
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
    const act1Anchor = dragMeta.find((d) => d.anchorActivityId === 'act1')!;
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
    const dragMeta = buildDragMeta(flattened, null, DAY_START);
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
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T09:00');
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
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T00:00');
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
    const dragMeta = buildDragMeta(flattened, null, '2027-07-13T00:00');
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
    const dragMeta = buildDragMeta(flattened, null, '2027-06-27T00:00');
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
      anchorActivityId: null,
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
    const dragMeta = buildDragMeta(flattened, null, '2027-07-13T00:00');
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
      anchorActivityId: 'anchor',
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

    const next = applyGroupActivityReorder(data, dropMeta, ['g1', 'g2'], DAY_START, false);
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
});
