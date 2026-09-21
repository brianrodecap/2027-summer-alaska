import { describe, expect, it } from 'vitest';

import { mapEmbedUrls, mapRouteNodes, mapStopLabels, routeUrls, travelSegments } from './dayMap';
import { buildLiveDays } from './liveDays';
import { buildTripView } from './tripModel';
import type { Activity, Scenario, Stay, Transit, TripData } from './types';

// Synthetic fixtures only. Every query here runs on a LIVE day (buildLiveDays):
// the map, route and travel queries read the day's visits, which are resolved
// for the current selections, so the tests choose selections and read results.

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

const place = (id: string | null, label: string) => ({ id, label });

const activity = (id: string, startAt: string, at: string | null, extra: Partial<Activity> = {}) =>
  ({
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
    place: at ? place(`p_${at}`, at) : null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    ...extra,
  }) satisfies Activity;

const transit = (id: string, from: string, to: string, extra: Partial<Transit> = {}): Transit => ({
  _id: id,
  legId: 'leg_test',
  journeyId: null,
  scenarioId: null,
  status: 'planning',
  mode: 'drive',
  from: place(`p_${from}`, from),
  to: place(`p_${to}`, to),
  departsAt: '2027-06-02T09:00',
  arrivesAt: '2027-06-02T10:00',
  routeId: null,
  routeVariant: null,
  booking: null,
  images: [],
  ...extra,
});

const stay = (id: string, lodge: string, inAt: string, outAt: string, extra: Partial<Stay> = {}) =>
  ({
    _id: id,
    legId: 'leg_test',
    scenarioId: null,
    checkInAt: inAt,
    checkOutAt: outAt,
    status: 'planning',
    lodging: { place: place(`p_${lodge}`, lodge) },
    booking: null,
    images: [],
    ...extra,
  }) satisfies Stay;

const scenario = (id: string, tone: 'ideal' | 'alternate', extra: Partial<Scenario> = {}) =>
  ({
    _id: id,
    legId: 'leg_test',
    tone,
    label: id,
    icon: 'help_outline',
    images: [],
    ...extra,
  }) satisfies Scenario;

function live(
  data: TripData,
  date: string,
  options: { picks?: Map<string, string>; routeTones?: Map<string, string> } = {},
) {
  const view = buildTripView(data);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: options.picks ?? new Map(),
    routeTones: options.routeTones ?? new Map(),
    mealOptionIndex: new Map(),
  });
  const visits = days.find((d) => d.date === date)!.visits!;
  return {
    visits,
    stops: mapStopLabels(visits),
    embed: mapEmbedUrls(visits),
    urls: routeUrls(visits),
    segments: travelSegments(visits),
    nodes: mapRouteNodes(visits).map(
      (n) => `${n.ref.kind}:${n.place.id}:${'rowKey' in n.ref ? n.ref.rowKey : ''}`,
    ),
  };
}

const param = (url: string, name: string) => new URL(url).searchParams.get(name);

describe('map stops for a day', () => {
  it('bookends a day with the stay it is in, and lists drives and activities in order', () => {
    const data = tripData();
    data.stays.push(stay('s1', 'Lodge', '2027-06-01T15:00', '2027-06-04T11:00'));
    data.transits.push(transit('t1', 'Lodge', 'Trailhead'));
    data.activities.push(
      activity('a1', '2027-06-02T10:30', 'Trailhead'),
      activity('a2', '2027-06-02T13:00', 'Cafe'),
      activity('a3', '2027-06-02T16:00', 'Lodge'),
    );
    expect(live(data, '2027-06-02').stops).toEqual([['Lodge', 'Trailhead', 'Cafe', 'Lodge']]);
    // A mid-stay night is a real "Staying" lodging on the map, not just its check-in/out days.
    expect(live(data, '2027-06-03').stops.flat()).toContain('Lodge');
  });

  it("drops a same-day excursion's remote destination and everything at it, keeping the drivable dock; never splits the day", () => {
    const data = tripData();
    data.stays.push(stay('s1', 'Lodge', '2027-06-01T15:00', '2027-06-04T11:00'));
    data.transits.push(
      transit('out', 'Dock', 'Remote', {
        mode: 'flight',
        from: place(null, 'Test Dock'),
        to: place(null, 'Remote Lodge'),
        departsAt: '2027-06-02T08:00',
        arrivesAt: '2027-06-02T08:30',
      }),
      transit('back', 'Remote', 'Dock', {
        mode: 'flight',
        from: place(null, 'Remote Lodge'),
        to: place(null, 'Test Dock'),
        departsAt: '2027-06-02T16:00',
        arrivesAt: '2027-06-02T16:30',
      }),
    );
    data.activities.push(activity('inside', '2027-06-02T11:00', 'Remote Lodge'));
    const { stops, urls } = live(data, '2027-06-02');
    expect(stops).toEqual([['Lodge', 'Test Dock', 'Lodge']]);
    expect(stops.flat()).not.toContain('Remote Lodge');
    // The full route link routes through the drivable dock as its only waypoint,
    // bookended by the lodging, and never through the fly-in-only destination.
    expect(urls.length).toBeGreaterThan(0);
    expect(param(urls[0], 'origin')).toBe('Lodge');
    expect(param(urls[urls.length - 1], 'destination')).toBe('Lodge');
    expect(param(urls[0], 'waypoints')).toBe('Test Dock');
  });

  it('splits a genuine one-way relocation into separate drivable runs, never one route across both', () => {
    const data = tripData();
    data.activities.push(
      activity('before', '2027-06-03T08:00', 'Origin Cafe'),
      activity('after', '2027-06-03T14:00', 'Destination Diner'),
    );
    data.transits.push(
      transit('fly', 'Origin Airport', 'Destination Airport', {
        mode: 'flight',
        from: place(null, 'Origin Airport'),
        to: place(null, 'Destination Airport'),
        departsAt: '2027-06-03T10:00',
        arrivesAt: '2027-06-03T12:00',
      }),
    );
    const { stops, urls, embed } = live(data, '2027-06-03');
    expect(stops).toEqual([
      ['Origin Cafe', 'Origin Airport'],
      ['Destination Airport', 'Destination Diner'],
    ]);
    expect(urls).toHaveLength(2);
    expect(param(urls[0], 'destination')).toBe('Origin Airport');
    expect(param(urls[1], 'origin')).toBe('Destination Airport');
    expect(embed).toHaveLength(2);
  });

  it('leaves out a cruise-cabin stay with no fixed place id on a "Staying" night', () => {
    const data = tripData();
    data.stays.push(
      stay('ship', 'Ship', '2027-06-01T12:00', '2027-06-05T08:00', {
        lodging: { place: place(null, 'Test Ship') },
      }),
    );
    data.activities.push(activity('a1', '2027-06-03T10:00', 'Port'));
    const { stops } = live(data, '2027-06-03');
    expect(stops).toEqual([['Port']]);
    expect(stops.flat()).not.toContain('Test Ship');
  });

  it('follows the active scenario branch, and a picked alternate', () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      activity('base', '2027-06-01T08:00', 'Lodge'),
      activity('ideal_1', '2027-06-01T10:00', 'IdealSpot', { scenarioId: 'i' }),
      activity('alt_1', '2027-06-01T10:00', 'AltSpot', { scenarioId: 'a' }),
    );
    expect(live(data, '2027-06-01').stops.flat()).toEqual(['Lodge', 'IdealSpot']);
    const alt = live(data, '2027-06-01', { picks: new Map([['a+i', 'a']]) }).stops.flat();
    expect(alt).toEqual(['Lodge', 'AltSpot']);
  });

  it("orders a scenario's rows as the day list shows them: its box after an unscoped row at the same instant", () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      // An unscoped 09:00 row and a fuzzy "Morning" (09:00) row inside the
      // ideal branch tie on the clock; a bare clock sort would put the fuzzy
      // one first, but the day list shows the backbone row, then the box.
      activity('backbone', '2027-06-01T09:00', 'Airstrip'),
      activity('boxed', '2027-06-01T09:00', 'Airstrip', {
        scenarioId: 'i',
        startAt: null,
        date: '2027-06-01',
        timeLabel: 'Morning',
      }),
      activity('alt', '2027-06-01T09:00', 'Elsewhere', { scenarioId: 'a' }),
    );
    const { visits } = live(data, '2027-06-01');
    const ids = visits.rest.map((v) => (v.kind === 'activity' ? v.activity._id : v.kind));
    expect(ids).toEqual(['backbone', 'boxed']);
  });
});

describe('a scenario box holding only a Stay boundary', () => {
  it("pins that stay to the day's end, as the day list does", () => {
    const data = tripData();
    data.scenarios.push(
      scenario('i', 'ideal', { date: '2027-06-01' }),
      scenario('a', 'alternate', { date: '2027-06-01' }),
    );
    data.stays.push(
      stay('s_i', 'IdealLodge', '2027-06-01T15:00', '2027-06-02T11:00', { scenarioId: 'i' }),
      stay('s_a', 'AltLodge', '2027-06-01T15:00', '2027-06-02T11:00', { scenarioId: 'a' }),
    );
    data.activities.push(activity('dinner', '2027-06-01T19:00', 'Cafe'));
    // The check-in sorts at 15:00, but the list pins it below the 19:00 dinner.
    const ideal = live(data, '2027-06-01');
    expect(ideal.stops).toEqual([['Cafe', 'IdealLodge']]);
    expect(ideal.visits.checkIns.map((v) => v.place.label)).toEqual(['IdealLodge']);
    expect(live(data, '2027-06-01', { picks: new Map([['a+i', 'a']]) }).stops).toEqual([
      ['Cafe', 'AltLodge'],
    ]);
  });
});

describe('a Transit that crosses midnight', () => {
  function overnight(options: { midDrive?: boolean; stage?: boolean } = {}): TripData {
    const data = tripData();
    data.routes.push({
      _id: 'r1',
      from: place('p_Origin', 'Origin'),
      to: place('p_Dest', 'Dest'),
      variants: [
        {
          tone: 'direct',
          label: 'Direct',
          places:
            options.stage === false
              ? []
              : [{ kind: 'waypoint', place: place('p_Mid', 'Mid'), durationMinutes: 150 }],
          finalLegMinutes: options.stage === false ? 210 : 60,
        },
      ],
      images: [],
    });
    data.transits.push(
      transit('night', 'Origin', 'Dest', {
        departsAt: '2027-06-02T22:00',
        arrivesAt: null,
        routeId: 'r1',
      }),
    );
    if (options.midDrive) data.activities.push(activity('snack', '2027-06-03T01:00', 'Snack'));
    return data;
  }

  it('reaches both endpoints from either day, and links through both from either day', () => {
    const data = overnight();
    for (const date of ['2027-06-02', '2027-06-03']) {
      const { stops, urls } = live(data, date);
      expect(stops).toEqual([['Origin', 'Dest']]);
      expect(urls).toHaveLength(1);
      expect(param(urls[0], 'origin')).toBe('Origin');
      expect(param(urls[0], 'destination')).toBe('Dest');
    }
  });

  it('never lists a route stage among the map labels, with or without one', () => {
    for (const stage of [true, false]) {
      const { stops } = live(overnight({ midDrive: true, stage }), '2027-06-03');
      expect(stops.flat()).not.toContain('Mid');
      expect(stops).toEqual([['Origin', 'Snack', 'Dest']]);
    }
  });

  it("puts a mid-drive Activity between the Transit's origin and destination, in true clock order", () => {
    expect(live(overnight({ midDrive: true }), '2027-06-03').stops).toEqual([
      ['Origin', 'Snack', 'Dest'],
    ]);
  });
});

describe('route variants that arrive on different days', () => {
  function twoVariants(): TripData {
    const data = tripData();
    data.routes.push({
      _id: 'r1',
      from: place('p_From', 'From'),
      to: place('p_To', 'To'),
      variants: [
        { tone: 'direct', label: 'Direct', places: [], finalLegMinutes: 100 },
        { tone: 'scenic', label: 'Scenic', places: [], finalLegMinutes: 240 },
      ],
      images: [],
    });
    data.transits.push(
      transit('t1', 'From', 'To', {
        departsAt: '2027-06-02T22:00',
        arrivesAt: null,
        routeId: 'r1',
      }),
    );
    return data;
  }

  it("widens the arrival day's map to the full trip only for the variant that spans midnight", () => {
    const data = twoVariants();
    const scenic = live(data, '2027-06-03', { routeTones: new Map([['t1', 'scenic']]) });
    expect(scenic.stops.flat()).toEqual(['From', 'To']);
    // Direct never reaches Jun 3, so nothing on that day belongs to it.
    const direct = live(data, '2027-06-03', { routeTones: new Map([['t1', 'direct']]) });
    expect(direct.stops.flat()).toEqual([]);
  });
});

describe('travel segments', () => {
  // A drive Transit's own from/to is routinely a plain label with no resolved
  // place id ("Fairbanks" -> "Copper Center"); the drive must still be totalled,
  // connecting the checkout and check-in stays on either side of it.
  it('totals a drive whose own from/to has no place id, between the checkout and check-in stays', () => {
    const data = tripData();
    data.stays.push(
      stay('test_checkout_stay', 'Origin Lodge', '2027-05-25T15:00', '2027-06-01T11:00'),
      stay('test_checkin_stay', 'Destination Lodge', '2027-06-01T17:00', '2027-06-05T11:00'),
    );
    data.transits.push(
      transit('t1', 'x', 'y', {
        from: place(null, 'Origin Town'),
        to: place(null, 'Destination Town'),
        departsAt: '2027-06-01T12:00',
        arrivesAt: '2027-06-01T16:00',
      }),
    );
    expect(live(data, '2027-06-01').segments).toEqual([
      {
        originId: 'p_Origin Lodge',
        destinationId: 'p_Destination Lodge',
        segmentKey: 'segment:stay-test_checkout_stay-2027-06-01->stay-test_checkin_stay-2027-06-01',
      },
    ]);
  });

  // segmentKey is what DayTravelChip resolves a travel-mode override against;
  // null means "no override to look up, fall back to DRIVE" — a "Staying"
  // night's stop has no single row of its own to key off.
  it('has a null segmentKey for a hop touching a Staying night', () => {
    const data = tripData();
    data.stays.push(stay('s1', 'Lodge', '2027-05-31T17:00', '2027-06-03T11:00'));
    data.activities.push(activity('a1', '2027-06-01T09:00', 'Activity Place'));
    const { segments } = live(data, '2027-06-01');
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.segmentKey === null)).toBe(true);
  });
});

describe('route nodes', () => {
  it('lists every occurrence of a place with a real id, undeduped, each with its row key', () => {
    const data = tripData();
    data.stays.push(stay('s1', 'Lodge', '2027-06-01T15:00', '2027-06-04T11:00'));
    data.activities.push(
      activity('a1', '2027-06-02T10:00', 'Cafe'),
      activity('a2', '2027-06-02T12:00', 'Lodge'),
      activity('a3', '2027-06-02T15:00', 'Cafe'),
    );
    const { nodes } = live(data, '2027-06-02');
    expect(nodes.filter((n) => n.startsWith('activity:p_Cafe'))).toHaveLength(2);
    // The stay in progress closes the day's markers; as a stay it has no row key.
    expect(nodes[0]).toBe('activity:p_Cafe:');
    expect(nodes[nodes.length - 1]).toBe('stay:p_Lodge:2027-06-02T00:00');
  });
});
