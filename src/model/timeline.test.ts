import { describe, expect, it } from 'vitest';

import { buildTimeline, type TimelineSelections } from './timeline';
import { buildTripView } from './tripModel';
import type { Activity, Stay, Transit, TripData } from './types';

// Synthetic fixtures only — never the real trip JSON.
function tripData(): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
    legs: [
      { _id: 'leg_test', tripId: 'trip_test', name: 'Leg', skeletonAuthority: 'self', images: [] },
    ],
    stays: [],
    transits: [],
    activities: [],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

function activity(id: string, startAt: string | null, extra: Partial<Activity> = {}): Activity {
  return {
    _id: id,
    legId: 'leg_test',
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
  };
}

function transit(extra: Partial<Transit> = {}): Transit {
  return {
    _id: 't1',
    legId: 'leg_test',
    journeyId: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: 'p_from', label: 'From' },
    to: { id: 'p_to', label: 'To' },
    departsAt: '2027-06-01T09:00',
    arrivesAt: '2027-06-01T10:00',
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
    ...extra,
  };
}

function stay(extra: Partial<Stay> = {}): Stay {
  return {
    _id: 's1',
    legId: 'leg_test',
    scenarioId: null,
    checkInAt: '2027-06-01T15:00',
    checkOutAt: '2027-06-03T11:00',
    status: 'planning',
    lodging: { place: { id: 'p_lodge', label: 'Lodge' } },
    booking: null,
    images: [],
    ...extra,
  };
}

const none: TimelineSelections = {
  activeScenarioIds: new Set(),
  routeTones: new Map(),
  mealOptionIndex: new Map(),
};
const ids = (events: { id: string }[]) => events.map((e) => e.id);

describe('buildTimeline', () => {
  it('emits Stay, Transit and Activity events in one chronological list, dated by timestamp', () => {
    const data = tripData();
    data.stays.push(stay());
    data.transits.push(transit());
    data.activities.push(activity('a1', '2027-06-01T09:30'));
    const { events } = buildTimeline(data, none);
    expect(ids(events)).toEqual([
      'depart:t1',
      'activity:a1',
      'arrive:t1',
      'check-in:s1',
      'check-out:s1',
    ]);
    expect(events.map((e) => e.date)).toEqual([
      '2027-06-01',
      '2027-06-01',
      '2027-06-01',
      '2027-06-01',
      '2027-06-03',
    ]);
    // A Stay emits only its boundaries — no per-night "Staying" event.
    expect(events.filter((e) => e.source.id === 's1')).toHaveLength(2);
  });

  it('leaves an event out unless its scenario is active', () => {
    const data = tripData();
    data.activities.push(
      activity('plain', '2027-06-01T09:00'),
      activity('on', '2027-06-01T10:00', { scenarioId: 'sc_on' }),
      activity('off', '2027-06-01T11:00', { scenarioId: 'sc_off' }),
    );
    data.transits.push(transit({ _id: 't_off', scenarioId: 'sc_off' }));
    data.stays.push(stay({ scenarioId: 'sc_off' }));
    const { events } = buildTimeline(data, { ...none, activeScenarioIds: new Set(['sc_on']) });
    expect(ids(events)).toEqual(['activity:plain', 'activity:on']);
  });

  it('skips an undated Activity and computes endAt only from an explicit duration', () => {
    const data = tripData();
    data.activities.push(
      activity('undated', null),
      activity('timed', '2027-06-01T09:00', { durationMinutes: 90 }),
      activity('open', '2027-06-01T12:00'),
    );
    const { events } = buildTimeline(data, none);
    expect(ids(events)).toEqual(['activity:timed', 'activity:open']);
    expect(events.map((e) => e.endAt)).toEqual(['2027-06-01T10:30', null]);
  });

  it('orders same-instant Activities fuzzy-first then alphabetically, and keeps real ties in data order', () => {
    const data = tripData();
    data.activities.push(
      activity('real_b', '2027-06-01T09:00', { text: 'Bravo' }),
      activity('real_a', '2027-06-01T09:00', { text: 'Alpha' }),
      // 'Morning' anchors at 09:00 — the same instant as the two above.
      activity('fuzzy_z', null, { date: '2027-06-01', timeLabel: 'Morning', text: 'Zulu' }),
      activity('fuzzy_c', null, { date: '2027-06-01', timeLabel: 'Morning', text: 'Charlie' }),
    );
    const { events } = buildTimeline(data, none);
    expect(ids(events)).toEqual([
      'activity:fuzzy_c',
      'activity:fuzzy_z',
      'activity:real_b',
      'activity:real_a',
    ]);
    expect(events.map((e) => e.fuzzy)).toEqual([true, true, false, false]);
  });
});

describe('buildTimeline — route variants', () => {
  // Direct arrives 23:40 the same night; Scenic reaches a waypoint at 00:00,
  // stops there the default 15 minutes, then arrives 02:15 the next day.
  function routed(): TripData {
    const data = tripData();
    data.routes.push({
      _id: 'r1',
      from: { id: 'p_from', label: 'From' },
      to: { id: 'p_to', label: 'To' },
      variants: [
        { tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 100 } },
        {
          tone: 'scenic',
          label: 'Scenic',
          places: [
            { kind: 'waypoint', place: { id: 'p_mid', label: 'Midway' }, travel: { minutes: 120 } },
          ],
          finalTravel: { minutes: 120 },
        },
      ],
      images: [],
    });
    data.transits.push(transit({ departsAt: '2027-06-02T22:00', arrivesAt: null, routeId: 'r1' }));
    return data;
  }
  const tone = (t: string): TimelineSelections => ({ ...none, routeTones: new Map([['t1', t]]) });

  it("emits only the selected variant's stages and its own Arrive, on that arrival's day", () => {
    const data = routed();
    const direct = buildTimeline(data, tone('direct'));
    expect(ids(direct.events)).toEqual(['depart:t1', 'arrive:t1']);
    expect(direct.arrivalOf.get('t1')).toBe('2027-06-02T23:40');

    const scenic = buildTimeline(data, tone('scenic'));
    expect(ids(scenic.events)).toEqual(['depart:t1', 'route-stage:t1:0', 'arrive:t1']);
    expect(scenic.arrivalOf.get('t1')).toBe('2027-06-03T02:15');
    // The Arrive row lands on the NEXT day — decided by its timestamp alone.
    expect(scenic.events.map((e) => e.date)).toEqual(['2027-06-02', '2027-06-03', '2027-06-03']);
    expect(scenic.events[1].place).toEqual(expect.objectContaining({ id: 'p_mid' }));
  });

  it('falls back to the model default variant when no tone is picked, matching buildTripView', () => {
    const data = routed();
    const timeline = buildTimeline(data, none);
    const view = buildTripView(data);
    const departDay = view.days.find((d) => d.date === '2027-06-02')!;
    expect(timeline.arrivalOf.get('t1')).toBe(departDay.transits[0].arrivesAt);
  });
});

describe('buildTimeline — Activities around a routed drive', () => {
  // 09:00 depart, 120 min straight to the destination (no stops).
  function drive(): TripData {
    const data = tripData();
    data.routes.push({
      _id: 'r1',
      from: { id: 'p_from', label: 'From' },
      to: { id: 'p_to', label: 'To' },
      variants: [{ tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 120 } }],
      images: [],
    });
    data.transits.push(transit({ arrivesAt: null, routeId: 'r1' }));
    return data;
  }

  it('sorts an Activity tied with the departure ahead of the Depart', () => {
    const data = drive();
    data.activities.push(activity('pickup', '2027-06-01T09:00'));
    expect(ids(buildTimeline(data, none).events)).toEqual([
      'activity:pickup',
      'depart:t1',
      'arrive:t1',
    ]);
  });

  it("times a mid-drive meal by the candidate the reader picked, not the first one's", () => {
    const data = drive();
    data.activities.push(
      activity('lunch', '2027-06-01T10:00', {
        mealType: 'lunch',
        options: [
          {
            _id: 'o_quick',
            diningFormat: 'grab-and-go',
            place: null,
            includedIn: null,
            booking: null,
          },
          { _id: 'o_sit', diningFormat: 'sit-down', place: null, includedIn: null, booking: null },
        ],
      }),
    );
    const arrival = (index: number) =>
      buildTimeline(data, { ...none, mealOptionIndex: new Map([['lunch', index]]) }).arrivalOf.get(
        't1',
      );
    expect(arrival(0)).toBe('2027-06-01T11:15'); // + 15 min grab-and-go
    expect(arrival(1)).toBe('2027-06-01T12:00'); // + 60 min sit-down
  });
});

describe('buildTimeline — meal places', () => {
  const meal = (): Activity =>
    activity('m1', '2027-06-02T08:00', {
      mealType: 'breakfast',
      options: [
        {
          _id: 'o_inc',
          diningFormat: 'included',
          place: { id: 'p_lodge', label: 'Lodge breakfast' },
          includedIn: { entity: 'stay', id: 's1' },
          booking: null,
        },
        {
          _id: 'o_cafe',
          diningFormat: 'sit-down',
          place: { id: 'p_cafe', label: 'Cafe' },
          includedIn: null,
          booking: null,
        },
      ],
    });

  it('defaults to the first candidate that names a place, and follows a picked one', () => {
    const data = tripData();
    data.stays.push(stay());
    data.activities.push(meal());
    expect(buildTimeline(data, none).events.find((e) => e.kind === 'activity')?.place?.id).toBe(
      'p_lodge',
    );
    const picked = buildTimeline(data, { ...none, mealOptionIndex: new Map([['m1', 1]]) });
    expect(picked.events.find((e) => e.kind === 'activity')?.place?.id).toBe('p_cafe');
  });

  it("with nothing picked, on the check-in day resolves to the first ACTIVE candidate's place, like the row footers", () => {
    const data = tripData();
    data.stays.push(stay({ checkInAt: '2027-06-02T15:00' }));
    data.activities.push(meal());
    // The 'included' lodge candidate is inactive today, so it must not win by
    // merely being first in the list.
    expect(buildTimeline(data, none).events.find((e) => e.kind === 'activity')?.place?.id).toBe(
      'p_cafe',
    );
  });

  it("skips an 'included' candidate on the Stay's check-in day, before it is underway", () => {
    const data = tripData();
    data.stays.push(stay({ checkInAt: '2027-06-02T15:00' }));
    data.activities.push(meal());
    // Index 0 among the ACTIVE candidates is now the cafe, not the lodge.
    const timeline = buildTimeline(data, { ...none, mealOptionIndex: new Map([['m1', 0]]) });
    expect(timeline.events.find((e) => e.kind === 'activity')?.place?.id).toBe('p_cafe');
  });

  it("keeps an 'included' candidate for a meal after check-in on the check-in day", () => {
    const data = tripData();
    data.stays.push(stay({ checkInAt: '2027-06-02T15:00' }));
    data.activities.push({ ...meal(), startAt: '2027-06-02T20:30', mealType: 'dinner' });
    expect(buildTimeline(data, none).events.find((e) => e.kind === 'activity')?.place?.id).toBe(
      'p_lodge',
    );
  });
});
