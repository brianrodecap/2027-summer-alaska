import { describe, expect, it } from 'vitest';

import { buildFilterGroups, dayHasVisibleContent, filterRows, rowMatches } from './filters';
import { buildLiveDays } from './liveDays';
import { buildTripView } from './tripModel';
import type { Activity, TripData } from './types';

// Synthetic fixtures only — never the real public/data/*.json content, which is
// the site's live, actively-edited itinerary rather than a fixed test fixture.

const activity = (id: string, legId: string, startAt: string, extra: Partial<Activity> = {}) =>
  ({
    _id: id,
    legId,
    scenarioId: null,
    status: 'planning',
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
    text: id,
    place: null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    ...extra,
  }) satisfies Activity;

// Two legs — a road leg then a cruise leg — each with a day of its own.
function twoLegTrip(): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
    legs: [
      {
        _id: 'leg_parks',
        tripId: 'trip_test',
        name: 'Parks',
        skeletonAuthority: 'self',
        images: [],
      },
      {
        _id: 'leg_cruise',
        tripId: 'trip_test',
        name: 'Cruise',
        skeletonAuthority: 'self',
        images: [],
      },
    ],
    stays: [],
    transits: [],
    activities: [
      activity('park_hike', 'leg_parks', '2027-06-01T09:00', { priority: 'high' }),
      activity('park_lunch', 'leg_parks', '2027-06-01T12:00'),
      activity('cruise_show', 'leg_cruise', '2027-06-10T20:00'),
    ],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

describe('filters', () => {
  const data = twoLegTrip();
  const view = buildTripView(data);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: new Map(),
    routeTones: new Map(),
    mealOptionIndex: new Map(),
  });

  it('builds a Booking/Attributes group plus one Leg option per leg, in leg order', () => {
    const groups = buildFilterGroups(view.legSummaries);
    expect(groups.map((g) => g.id)).toEqual(['booking', 'attr', 'leg']);
    expect(groups.find((g) => g.id === 'leg')!.options.map((o) => o.token)).toEqual(
      data.legs.map((l) => `leg:${l._id}`),
    );
  });

  it('rowMatches ANDs across groups but ORs within one', () => {
    const tags = ['leg:leg_parks', 'attr:highlight'];
    expect(rowMatches(tags, new Set())).toBe(true); // no active filters matches everything
    expect(rowMatches(tags, new Set(['leg:leg_parks']))).toBe(true);
    expect(rowMatches(tags, new Set(['leg:leg_cruise']))).toBe(false);
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'leg:leg_cruise']))).toBe(true); // OR within the leg group
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'attr:attention']))).toBe(false); // AND across groups
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'attr:highlight']))).toBe(true);
  });

  const lookup = { activities: view.activitiesById, transits: view.transitsById };

  it('dayHasVisibleContent hides a day once its own leg is filtered out, and keeps it once that leg is active', () => {
    const cruiseDay = days.find((d) => d.leg._id === 'leg_cruise');
    expect(cruiseDay).toBeDefined();
    expect(dayHasVisibleContent(cruiseDay!, new Set(), lookup)).toBe(true);
    expect(dayHasVisibleContent(cruiseDay!, new Set(['leg:leg_parks']), lookup)).toBe(false);
    expect(dayHasVisibleContent(cruiseDay!, new Set(['leg:leg_cruise']), lookup)).toBe(true);
  });

  it('dayHasVisibleContent keeps a day whose only match is in a scenario tab the reader is not on', () => {
    const trip = twoLegTrip();
    trip.activities = [
      activity('ideal_walk', 'leg_parks', '2027-06-01T09:00', { scenarioId: 'ideal' }),
      activity('alt_tour', 'leg_parks', '2027-06-01T10:00', {
        scenarioId: 'alt',
        priority: 'high',
      }),
    ];
    trip.scenarios = ['ideal', 'alt'].map((id) => ({
      _id: id,
      legId: 'leg_parks',
      tone: id === 'ideal' ? ('ideal' as const) : ('alternate' as const),
      label: id,
      icon: 'help_outline',
      images: [],
    }));
    const tripView = buildTripView(trip);
    const live = buildLiveDays(tripView, trip, {
      scenarioPicks: new Map(),
      routeTones: new Map(),
      mealOptionIndex: new Map(),
    }).days.find((d) => d.date === '2027-06-01')!;
    const entities = { activities: tripView.activitiesById, transits: tripView.transitsById };
    // The alternate (holding the highlight) is not the selected tab, so its
    // activity has no row — but the day must still match "highlight".
    expect(live.rows.some((r) => r.type === 'activity')).toBe(false);
    expect(dayHasVisibleContent(live, new Set(['attr:highlight']), entities)).toBe(true);
    expect(dayHasVisibleContent(live, new Set(['attr:attention']), entities)).toBe(false);
  });

  it('filterRows keeps every row when nothing is active', () => {
    const day = days[0];
    expect(filterRows(day.rows, new Set())).toBe(day.rows); // identity short-circuit
  });

  it('filterRows drops the rows that no longer match, one row per event', () => {
    const dayWithHighlight = days.find((d) =>
      d.rows.some((r) => r.type === 'activity' && r.activity.priority),
    );
    expect(dayWithHighlight).toBeDefined();
    const filtered = filterRows(dayWithHighlight!.rows, new Set(['attr:highlight']));
    expect(filtered.flatMap((r) => (r.type === 'activity' ? [r.activity._id] : []))).toEqual([
      'park_hike',
    ]);
  });
});
