import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
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
    bookings: [],
    travelModeOverrides: [],
    routes: [],
  };
}

function activity(id: string, startAt: string | null, extra: Partial<Activity> = {}): Activity {
  return {
    _id: id,
    legId: 'leg_test',
    scenarioId: null,
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
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

function transit(extra: Partial<Transit> = {}): Transit {
  return {
    _id: 't1',
    legId: 'leg_test',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    mode: 'drive',
    from: { id: 'p_from', label: 'From' },
    to: { id: 'p_to', label: 'To' },
    departsAt: '2027-06-01T09:00',
    arrivesAt: '2027-06-01T10:00',
    routeId: null,
    routeVariant: null,
    bookingId: null,
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
    lodging: { place: { id: 'p_lodge', label: 'Lodge' } },
    bookingId: null,
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
  describe('a booking’s own clock (clockZone)', () => {
    const PAGE = { id: 'p_page', label: 'Page', timeZone: 'America/Phoenix' };

    it('reads an activity’s start on its clockZone, not its place’s', () => {
      // A tour sold at 10:00 on Denver time, at a place on Phoenix time, is
      // 16:00 UTC; the 09:30 stop on Page's clock is 16:30 UTC, after it.
      const data = tripData();
      data.activities.push(
        activity('stop', '2027-06-01T09:30', { place: PAGE }),
        activity('tour', '2027-06-01T10:00', { place: PAGE, clockZone: 'America/Denver' }),
      );
      const { events } = buildTimeline(data, none);
      expect(ids(events)).toEqual(['activity:tour', 'activity:stop']);
      expect(events.find((e) => e.id === 'activity:tour')?.zone).toBe('America/Denver');
    });

    it('keeps the trip’s clock on where the trip is, not on a booking’s stated clock', () => {
      // The tour, 10:00 on Denver time, is 09:00 in Page, so the trip's clock
      // there is Page's: the zone-less 09:45 snack is 16:45 UTC, after it.
      const data = tripData();
      data.activities.push(
        activity('tour', '2027-06-01T10:00', { place: PAGE, clockZone: 'America/Denver' }),
        activity('snack', '2027-06-01T09:45'),
      );
      expect(ids(buildTimeline(data, none).events)).toEqual(['activity:tour', 'activity:snack']);
    });

    it('falls back to the place’s clock for a clockZone it doesn’t know', () => {
      const data = tripData();
      data.activities.push(
        activity('tour', '2027-06-01T10:00', { place: PAGE, clockZone: 'Mars/Olympus' }),
      );
      expect(buildTimeline(data, none).events[0].zone).toBe('America/Phoenix');
    });

    it('reads it on the place’s clock without one', () => {
      const data = tripData();
      data.activities.push(activity('tour', '2027-06-01T10:00', { place: PAGE, clockZone: null }));
      expect(buildTimeline(data, none).events[0].zone).toBe('America/Phoenix');
    });

    it('reads a stay’s check-in and checkout on its clockZone', () => {
      const data = tripData();
      data.stays.push(stay({ lodging: { place: PAGE }, clockZone: 'America/Denver' }));
      const zones = buildTimeline(data, none).events.map((e) => e.zone);
      expect(zones).toEqual(['America/Denver', 'America/Denver']);
    });
  });

  it('ends an activity after its real length, across a daylight-saving change', () => {
    // Denver springs forward at 02:00 on Mar 14 2027: 01:00 MST plus two real
    // hours is 04:00 MDT.
    const data = tripData();
    data.activities.push(
      activity('a1', '2027-03-14T01:00', {
        durationMinutes: 120,
        place: { id: 'p_den', label: 'Denver', timeZone: 'America/Denver' },
      }),
    );
    const event = buildTimeline(data, none).events.find((e) => e.id === 'activity:a1');
    expect(event?.endAt).toBe('2027-03-14T04:00');
  });

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

  // routed() with each place on a clock: Page is UTC-7, Denver UTC-6 in June.
  const zonedRoute = (from: string, to: string) => {
    const data = routed();
    data.transits[0] = {
      ...data.transits[0],
      from: { id: 'p_from', label: 'From', timeZone: from },
      to: { id: 'p_to', label: 'To', timeZone: to },
    };
    data.routes[0].variants[1].places[0].place = {
      id: 'p_mid',
      label: 'Midway',
      timeZone: to,
    };
    return data;
  };

  it('walks a drive across a zone line onto the destination’s clock', () => {
    // 22:00 in Page is 05:00 UTC; 100 minutes on is 06:40 UTC, 00:40 in Denver.
    const events = buildTimeline(
      zonedRoute('America/Phoenix', 'America/Denver'),
      tone('direct'),
    ).events;
    const arrive = events.find((e) => e.kind === 'arrive');
    expect(arrive).toMatchObject({ at: '2027-06-03T00:40', zone: 'America/Denver' });
  });

  it('times each stage on its own place’s clock', () => {
    // 120 minutes from 05:00 UTC is 07:00 UTC, 01:00 in Denver.
    const events = buildTimeline(
      zonedRoute('America/Phoenix', 'America/Denver'),
      tone('scenic'),
    ).events;
    const stage = events.find((e) => e.kind === 'route-stage');
    expect(stage).toMatchObject({ at: '2027-06-03T01:00', zone: 'America/Denver' });
  });

  it('times a stage at a place with no zone on the departure’s clock', () => {
    const data = zonedRoute('America/Phoenix', 'America/Denver');
    data.routes[0].variants[1].places[0].place = { id: 'p_mid', label: 'Midway' };
    // 120 minutes from 22:00 in Page.
    const stage = buildTimeline(data, tone('scenic')).events.find((e) => e.kind === 'route-stage');
    expect(stage).toMatchObject({ at: '2027-06-03T00:00', zone: 'America/Phoenix' });
  });

  it('walks a drive whose departure has no zone on plain wall clocks', () => {
    const stage = buildTimeline(routed(), tone('scenic')).events.find(
      (e) => e.kind === 'route-stage',
    );
    expect(stage).toMatchObject({ at: '2027-06-03T00:00', zone: null });
  });

  it('walks a zone-less departure on the trip’s clock, as the day list reads it', () => {
    // A Denver call at 21:00 puts the trip's clock on Denver, so the zone-less
    // 22:00 departure is 04:00 UTC; 100 minutes on is 05:40 UTC, 22:40 in Page.
    const data = routed();
    data.transits[0] = {
      ...data.transits[0],
      to: { id: 'p_to', label: 'To', timeZone: 'America/Phoenix' },
    };
    data.activities.push(
      activity('denver_call', '2027-06-02T21:00', {
        place: { id: 'p_call', label: 'Call', timeZone: 'America/Denver' },
      }),
    );
    const arrive = buildTimeline(data, tone('direct')).events.find((e) => e.kind === 'arrive');
    expect(arrive).toMatchObject({ at: '2027-06-02T22:40', zone: 'America/Phoenix' });
  });

  it('reads a zone-less stop during a drive on the trip’s clock, as the day list does', () => {
    // Departs 22:00 in Page (05:00 UTC). A Denver call at 22:10 (04:10 UTC) puts
    // the trip's clock on Denver, so the zone-less 22:20 snack is 04:20 UTC:
    // before leaving, so not folded in. Arrival stays 23:40 in Page.
    const data = zonedRoute('America/Phoenix', 'America/Phoenix');
    data.activities.push(
      activity('denver_call', '2027-06-02T22:10', {
        place: { id: 'p_call', label: 'Call', timeZone: 'America/Denver' },
      }),
      activity('snack', '2027-06-02T22:20', { durationMinutes: 60 }),
    );
    const arrive = buildTimeline(data, tone('direct')).events.find((e) => e.kind === 'arrive');
    expect(arrive).toMatchObject({ at: '2027-06-02T23:40', zone: 'America/Phoenix' });
  });

  it('folds in an activity that starts after the departure on its own clock', () => {
    // Departs 22:00 in Denver (04:00 UTC). The 21:30 stop in Page is 04:30 UTC,
    // after it, so its hour is spent mid-drive: arrival is 06:40 UTC, 23:40 in Page.
    const data = zonedRoute('America/Denver', 'America/Phoenix');
    data.activities.push(
      activity('stop', '2027-06-02T21:30', {
        durationMinutes: 60,
        place: { id: 'p_stop', label: 'Stop', timeZone: 'America/Phoenix' },
      }),
    );
    const arrive = buildTimeline(data, tone('direct')).events.find((e) => e.kind === 'arrive');
    expect(arrive).toMatchObject({ at: '2027-06-02T23:40', zone: 'America/Phoenix' });
  });

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
    const view = buildTripView(data, TEST_TODAY);
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
            bookingId: null,
          },
          {
            _id: 'o_sit',
            diningFormat: 'sit-down',
            place: null,
            includedIn: null,
            bookingId: null,
          },
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
          bookingId: null,
        },
        {
          _id: 'o_cafe',
          diningFormat: 'sit-down',
          place: { id: 'p_cafe', label: 'Cafe' },
          includedIn: null,
          bookingId: null,
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

describe('buildTimeline — time zones', () => {
  const PAGE = 'America/Phoenix'; // Arizona: no daylight saving
  const NAVAJO = 'America/Denver'; // Navajo Nation: daylight saving, an hour ahead in summer
  const at = (id: string, zone: string | undefined) => ({
    id,
    label: id,
    ...(zone ? { timeZone: zone } : {}),
  });

  it('gives each event the zone of the place its clock is on', () => {
    const data = tripData();
    data.stays = [stay({ lodging: { place: at('p_lodge', PAGE) } })];
    data.transits = [transit({ from: at('p_from', PAGE), to: at('p_to', NAVAJO) })];
    data.activities = [activity('a1', '2027-06-01T12:00', { place: at('p_canyon', NAVAJO) })];
    const zones = Object.fromEntries(buildTimeline(data, none).events.map((e) => [e.id, e.zone]));
    expect(zones).toEqual({
      'check-in:s1': PAGE,
      'check-out:s1': PAGE,
      'depart:t1': PAGE,
      'arrive:t1': NAVAJO,
      'activity:a1': NAVAJO,
    });
  });

  it('orders events by when they happen, each on its own clock', () => {
    const data = tripData();
    data.activities = [
      // 10:30 in Page is 17:30 UTC; 11:00 at the canyon is 17:00 UTC.
      activity('page_lunch', '2027-06-01T10:30', { place: at('p_page', PAGE) }),
      activity('canyon_tour', '2027-06-01T11:00', { place: at('p_canyon', NAVAJO) }),
    ];
    expect(ids(buildTimeline(data, none).events)).toEqual([
      'activity:canyon_tour',
      'activity:page_lunch',
    ]);
  });

  it('reads a time before any zoned one on the first zone the trip has', () => {
    const data = tripData();
    data.activities = [
      // No zone and earliest of all: read on Page's clock, the first one known.
      activity('early', '2027-06-01T10:40', { place: at('p_early', undefined) }),
      activity('page_walk', '2027-06-01T10:50', { place: at('p_page', PAGE) }),
      activity('canyon_tour', '2027-06-01T11:00', { place: at('p_canyon', NAVAJO) }),
    ];
    expect(ids(buildTimeline(data, none).events)).toEqual([
      'activity:canyon_tour',
      'activity:early',
      'activity:page_walk',
    ]);
  });

  it('keeps an open meal on its own clock, whichever candidate is picked', () => {
    const data = tripData();
    data.activities = [
      activity('lunch', '2027-06-01T12:00', {
        mealType: 'lunch',
        place: null,
        options: [
          {
            _id: 'o_page',
            diningFormat: 'sit-down',
            place: at('p_cafe', PAGE),
            includedIn: null,
            bookingId: null,
          },
        ],
      }),
    ];
    const lunch = buildTimeline(data, none).events.find((e) => e.id === 'activity:lunch');
    expect(lunch?.place?.id).toBe('p_cafe');
    expect(lunch?.zone).toBeNull();
  });

  it('reads a place with no zone on the clock of the event before it', () => {
    const data = tripData();
    data.activities = [
      activity('canyon_tour', '2027-06-01T11:00', { place: at('p_canyon', NAVAJO) }),
      // No zone: read on the canyon's clock, so 11:20 comes after the tour.
      activity('snack', '2027-06-01T11:20', { place: at('p_snack', undefined) }),
      // 10:45 in Page is 17:45 UTC, after both.
      activity('page_walk', '2027-06-01T10:45', { place: at('p_page', PAGE) }),
    ];
    expect(ids(buildTimeline(data, none).events)).toEqual([
      'activity:canyon_tour',
      'activity:snack',
      'activity:page_walk',
    ]);
  });
});
