import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
import { daySelectionRows, daySelectionState } from './daySelection';
import { buildLiveDays } from './liveDays';
import { applyMoveToDay, selectionToMove } from './moveToDay';
import { activityNodeKey, buildTripView } from './tripModel';
import type { Activity, Day, Scenario, Stay, Transit, TripData } from './types';

const DAY = '2027-06-30';

function trip(): TripData {
  return {
    trip: { _id: 'trip_t', name: 'Trip', travelers: [], images: [] },
    legs: [
      { _id: 'leg_a', tripId: 'trip_t', name: 'Parks', skeletonAuthority: 'self', images: [] },
    ],
    stays: [],
    transits: [],
    activities: [],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    dayTitles: [],
    routes: [],
  };
}

function activity(id: string, startAt: string, extra: Partial<Activity> = {}): Activity {
  return {
    _id: id,
    legId: 'leg_a',
    scenarioId: null,
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    text: id,
    place: null,
    bookingId: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    ...extra,
  };
}

const scenario = (id: string, tone: Scenario['tone']): Scenario => ({
  _id: id,
  legId: 'leg_a',
  tone,
  label: id,
  icon: 'cloud',
  images: [],
});

function dayOf(data: TripData): Day {
  const view = buildTripView(data, TEST_TODAY);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: new Map(),
    routeVariantIds: new Map(),
    mealOptionIndex: new Map(),
  });
  return days.find((d) => d.date === DAY)!;
}

// A day with a plain activity, a drive, two plans of one activity each, and a
// stay checking in.
function busyDay(): TripData {
  const data = trip();
  data.scenarios.push(scenario('ideal', 'ideal'), scenario('alt', 'alternate'));
  data.activities.push(
    activity('walk', `${DAY}T08:00`),
    activity('fly', `${DAY}T10:00`, { scenarioId: 'ideal' }),
    activity('wiseman', `${DAY}T10:30`, { scenarioId: 'alt' }),
  );
  data.transits.push({
    _id: 'drive',
    legId: 'leg_a',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    mode: 'drive',
    from: { id: 'p_a', label: 'A' },
    to: { id: 'p_b', label: 'B' },
    departsAt: `${DAY}T13:00`,
    arrivesAt: null,
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
  } satisfies Transit);
  data.stays.push({
    _id: 'lodge',
    legId: 'leg_a',
    scenarioId: null,
    checkInAt: `${DAY}T16:00`,
    checkOutAt: '2027-07-02T11:00',
    lodging: { place: { id: 'p_l', label: 'Lodge' } },
    bookingId: null,
    images: [],
  } satisfies Stay);
  return data;
}

describe('what "select this day" selects', () => {
  it('takes each activity, drive and plan group, and leaves the stay', () => {
    const rows = daySelectionRows(dayOf(busyDay()), new Set());
    const walk = rows.find((r) => r.members.activityIds.includes('walk'))!;
    expect(walk).toMatchObject({
      dragId: activityNodeKey('walk'),
      containerId: DAY,
      isScenarioGroup: false,
    });
    expect(rows.some((r) => r.members.transitIds.includes('drive'))).toBe(true);
    expect(rows.some((r) => r.members.stayIds.length > 0)).toBe(false);
    // The plan group is one row carrying both plans' entries.
    const group = rows.filter((r) => r.isScenarioGroup);
    expect(group).toHaveLength(1);
    expect(group[0].members.activityIds.sort()).toEqual(['fly', 'wiseman']);
    expect(rows.some((r) => !r.isScenarioGroup && r.members.activityIds.includes('fly'))).toBe(
      false,
    );
  });

  it('takes only what the filters show', () => {
    const data = busyDay();
    data.bookings.push({
      _id: 'b',
      status: 'planning',
      pricing: null,
      confirmationNumber: null,
    });
    data.activities[0].bookingId = 'b';
    const rows = daySelectionRows(dayOf(data), new Set(['booking:needs']));
    const ids = rows.flatMap((r) => r.members.activityIds);
    expect(ids).toContain('walk');
    expect(rows.some((r) => r.members.transitIds.includes('drive'))).toBe(false);
  });

  it('is nothing on a day with nothing to select', () => {
    const data = trip();
    data.stays.push({
      _id: 'lodge',
      legId: 'leg_a',
      scenarioId: null,
      checkInAt: `${DAY}T16:00`,
      checkOutAt: '2027-07-02T11:00',
      lodging: { place: { id: 'p_l', label: 'Lodge' } },
      bookingId: null,
      images: [],
    });
    expect(daySelectionRows(dayOf(data), new Set())).toEqual([]);
  });
});

describe('how much of a day is selected', () => {
  const rows = daySelectionRows(dayOf(busyDay()), new Set());

  it('is none, some or all of its rows', () => {
    expect(daySelectionState(rows, new Set())).toBe('none');
    expect(daySelectionState(rows, new Set([rows[0].dragId]))).toBe('some');
    expect(daySelectionState(rows, new Set(rows.map((r) => r.dragId)))).toBe('all');
  });

  it('ignores selected rows that belong to other days', () => {
    expect(daySelectionState(rows, new Set(['activity-elsewhere']))).toBe('none');
  });
});

describe('moving a whole selected day', () => {
  it('takes the plain rows onto the target and shifts the plan group, as the bar would', () => {
    const data = busyDay();
    const moves = selectionToMove(daySelectionRows(dayOf(data), new Set()));
    expect(moves.find((m) => m.groupFrom)?.groupFrom).toBe(DAY);
    const result = applyMoveToDay(data, moves, { date: '2027-07-05', legId: 'leg_a' });
    if (!('data' in result)) throw new Error(result.error);
    const start = (id: string) => result.data.activities.find((a) => a._id === id)?.startAt;
    expect(start('walk')).toBe('2027-07-05T08:00');
    expect(start('fly')).toBe('2027-07-05T10:00');
    expect(start('wiseman')).toBe('2027-07-05T10:30');
    expect(result.data.activities.find((a) => a._id === 'fly')?.scenarioId).toBe('ideal');
    expect(result.data.transits[0].departsAt).toBe('2027-07-05T13:00');
    expect(result.data.stays[0].checkInAt).toBe(data.stays[0].checkInAt);
  });
});
