import { describe, expect, it } from 'vitest';

import { buildLiveDays } from './liveDays';
import { buildTripView } from './tripModel';
import type { Activity, DayRow, Scenario, Stay, Transit, TripData } from './types';

// Synthetic fixtures only. Each test runs a trip through the real pipeline
// (picks -> timeline -> layoutDay, via buildLiveDays) and checks the rows one
// date lays out; the inline snapshots were reviewed against the statically
// built day these rows replaced (which agreed with them row for row).

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

const activity = (id: string, startAt: string | null, extra: Partial<Activity> = {}): Activity => ({
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
});

const transit = (extra: Partial<Transit> = {}): Transit => ({
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
});

const stay = (extra: Partial<Stay> = {}): Stay => ({
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
});

// A signature of a row list that ignores object identity: one line per row,
// with a scenario box followed by its ACTIVE branch's rows, indented.
function sig(rows: DayRow[]): string[] {
  return rows.flatMap((row): string[] => {
    switch (row.type) {
      case 'stay':
        return [`stay:${row.stay._id}:${row.relation}@${row.key}`];
      case 'transit':
        return [
          row.phase === 'stage'
            ? `stage:${row.transit._id}@${row.key}`
            : `${row.transit._id}:${row.phase}@${row.key}`,
        ];
      case 'activity':
        return [`activity:${row.activity._id}`];
      case 'box': {
        const active = row.tracks.find((t) => t.active);
        return [
          `tabs@${row.key}[${row.tracks.map((t) => t.scenario._id).join(',')}]`,
          ...(active ? sig(active.rows).map((line) => `  ${line}`) : []),
        ];
      }
    }
  });
}

// The rows of one live day (the real pipeline: picks -> timeline -> layoutDay),
// as a signature — with the top-level tab strip expanded to that day's tracks.
function rowsOf(data: TripData, date: string, picks = new Map<string, string>()): string[] {
  const view = buildTripView(data);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: picks,
    routeTones: new Map(),
    mealOptionIndex: new Map(),
  });
  return sig(days.find((d) => d.date === date)!.rows);
}

describe('layoutDay', () => {
  it('emits no box on a date where the picked member has no content', () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      activity('i1', '2027-06-01T09:00', { scenarioId: 'i' }),
      activity('i2', '2027-06-02T09:00', { scenarioId: 'i' }),
      activity('a1', '2027-06-01T10:00', { scenarioId: 'a' }),
    );
    const picks = new Map([['a+i', 'a']]);
    expect(rowsOf(data, '2027-06-02', picks)).toEqual([]);
    expect(rowsOf(data, '2027-06-02')).toEqual(['tabs@2027-06-02T09:00[i]', '  activity:i2']);
  });

  it("lists timed (startAt, null date) scenario activities among a track's members", () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      activity('timed', '2027-06-01T09:00', { scenarioId: 'i' }),
      activity('fuzzy', null, { scenarioId: 'i', date: '2027-06-01', timeLabel: 'Morning' }),
      activity('other_day', '2027-06-02T09:00', { scenarioId: 'i' }),
    );
    const view = buildTripView(data);
    const { days } = buildLiveDays(view, data, {
      scenarioPicks: new Map(),
      routeTones: new Map(),
      mealOptionIndex: new Map(),
    });
    const box = days.find((d) => d.date === '2027-06-01')!.rows.find((r) => r.type === 'box');
    if (box?.type !== 'box') throw new Error('expected a scenario box');
    const ideal = box.tracks.find((t) => t.scenario._id === 'i')!;
    expect([...ideal.members.activityIds].sort()).toEqual(['fuzzy', 'timed']);
  });

  it('lays out backbone rows: stay relations, Transit boundaries, sections, fuzzy ties', () => {
    const data = tripData();
    data.stays.push(stay());
    data.transits.push(
      transit({ _id: 't1', departsAt: '2027-06-02T09:00', arrivesAt: '2027-06-02T10:00' }),
    );
    data.activities.push(
      activity('a1', '2027-06-02T11:00'),
      activity('a2', '2027-06-02T11:00'),
      activity('f1', null, { date: '2027-06-02', timeLabel: 'Morning', text: 'Zed' }),
      activity('f2', null, { date: '2027-06-02', timeLabel: 'Morning', text: 'Alpha' }),
    );
    const dates = ['2027-06-01', '2027-06-02', '2027-06-03'];
    expect(Object.fromEntries(dates.map((d) => [d, rowsOf(data, d)]))).toMatchInlineSnapshot(`
      {
        "2027-06-01": [
          "stay:s1:Check in@2027-06-01T15:00",
        ],
        "2027-06-02": [
          "stay:s1:Staying@2027-06-02T00:00",
          "activity:f2",
          "activity:f1",
          "t1:depart@2027-06-02T09:00",
          "t1:arrive@2027-06-02T10:00",
          "activity:a1",
          "activity:a2",
        ],
        "2027-06-03": [
          "stay:s1:Check out@2027-06-03T11:00",
        ],
      }
    `);
  });

  it('lays out a routed Transit that crosses midnight, on both days (selected variant only)', () => {
    const data = tripData();
    data.routes.push({
      _id: 'r1',
      from: { id: 'p_from', label: 'From' },
      to: { id: 'p_to', label: 'To' },
      variants: [
        {
          tone: 'scenic',
          label: 'Scenic',
          places: [
            { kind: 'waypoint', place: { id: 'p_mid', label: 'Mid' }, travel: { minutes: 150 } },
          ],
          finalTravel: { minutes: 120 },
        },
        { tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 100 } },
      ],
      images: [],
    });
    data.transits.push(
      transit({
        departsAt: '2027-06-02T22:00',
        arrivesAt: null,
        routeId: 'r1',
        routeVariant: 'scenic',
      }),
    );
    data.activities.push(activity('a1', '2027-06-03T09:00'));
    const dates = ['2027-06-02', '2027-06-03'];
    expect(Object.fromEntries(dates.map((d) => [d, rowsOf(data, d)]))).toMatchInlineSnapshot(`
      {
        "2027-06-02": [
          "t1:depart@2027-06-02T22:00",
        ],
        "2027-06-03": [
          "stage:t1@2027-06-03T00:30",
          "t1:arrive@2027-06-03T02:45",
          "activity:a1",
        ],
      }
    `);
  });

  it("lays out a scenario group: one tab strip at the default member's anchor, backbone around it", () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      activity('before', '2027-06-01T07:00'),
      activity('ideal_1', '2027-06-01T10:00', { scenarioId: 'i' }),
      activity('ideal_2', '2027-06-01T11:00', { scenarioId: 'i' }),
      activity('alt_1', '2027-06-01T08:00', { scenarioId: 'a' }),
      activity('after', '2027-06-01T19:00'),
    );
    const live = rowsOf(data, '2027-06-01');
    expect(live.some((row) => row.startsWith('tabs@2027-06-01T10:00[i,a]'))).toBe(true);
    expect(live).toMatchInlineSnapshot(`
      [
        "activity:before",
        "tabs@2027-06-01T10:00[i,a]",
        "  activity:ideal_1",
        "  activity:ideal_2",
        "activity:after",
      ]
    `);
  });

  it('follows a picked alternate: only its own rows are filled in', () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    data.activities.push(
      activity('ideal_1', '2027-06-01T10:00', { scenarioId: 'i' }),
      activity('alt_1', '2027-06-01T08:00', { scenarioId: 'a' }),
    );
    const live = rowsOf(data, '2027-06-01', new Map([['a+i', 'a']]));
    expect(live).toContain('  activity:alt_1');
    expect(live).not.toContain('  activity:ideal_1');
    expect(live).toMatchInlineSnapshot(`
      [
        "tabs@2027-06-01T10:00[i,a]",
        "  activity:alt_1",
      ]
    `);
  });

  it('lays out a nested group under the active branch', () => {
    const data = tripData();
    data.scenarios.push(
      scenario('i', 'ideal'),
      scenario('a', 'alternate'),
      scenario('c_i', 'ideal', { parentScenarioId: 'a' }),
      scenario('c_a', 'alternate', { parentScenarioId: 'a' }),
    );
    data.activities.push(
      activity('i1', '2027-06-01T09:00', { scenarioId: 'i' }),
      activity('a1', '2027-06-01T08:00', { scenarioId: 'a' }),
      activity('ci1', '2027-06-01T12:00', { scenarioId: 'c_i' }),
      activity('ca1', '2027-06-01T13:00', { scenarioId: 'c_a' }),
    );
    const live = rowsOf(data, '2027-06-01', new Map([['a+i', 'a']]));
    expect(live).toContain('    activity:ci1');
    expect(live).toMatchInlineSnapshot(`
      [
        "tabs@2027-06-01T09:00[i,a]",
        "  activity:a1",
        "  tabs@2027-06-01T12:00[c_i,c_a]",
        "    activity:ci1",
      ]
    `);
  });

  it("takes sunrise/sunset places from the active branch's rows when the backbone has none", () => {
    const data = tripData();
    data.scenarios.push(scenario('i', 'ideal'), scenario('a', 'alternate'));
    const at = (id: string) => ({ id: `p_${id}`, label: id });
    data.activities.push(
      activity('i1', '2027-06-01T09:00', { scenarioId: 'i', place: at('i_first') }),
      activity('i2', '2027-06-01T17:00', { scenarioId: 'i', place: at('i_last') }),
      activity('a1', '2027-06-01T10:00', { scenarioId: 'a', place: at('a_only') }),
    );
    const headerOf = (picks: Map<string, string>) => {
      const view = buildTripView(data);
      const { days } = buildLiveDays(view, data, {
        scenarioPicks: picks,
        routeTones: new Map(),
        mealOptionIndex: new Map(),
      });
      const day = days.find((d) => d.date === '2027-06-01')!;
      return [day.sunrisePlaceId, day.sunsetPlaceId];
    };
    expect(headerOf(new Map())).toEqual(['p_i_first', 'p_i_last']);
    expect(headerOf(new Map([['a+i', 'a']]))).toEqual(['p_a_only', 'p_a_only']);
  });
});
