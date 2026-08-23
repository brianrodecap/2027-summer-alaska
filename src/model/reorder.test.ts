import { describe, expect, it } from 'vitest';

import { applyActivityReorder, buildDragMeta, type DragMeta, resolveDropTiming } from './reorder';
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
    order: null,
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
    ...overrides,
  };
}

describe('resolveDropTiming', () => {
  it('anchors exactly at the preceding item', () => {
    expect(resolveDropTiming('2027-06-01T12:00', DAY_START)).toEqual({
      startAt: '2027-06-01T12:00',
    });
  });

  it('anchors to the container day start when dropped with nothing before it', () => {
    expect(resolveDropTiming(null, DAY_START)).toEqual({ startAt: DAY_START });
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
});
