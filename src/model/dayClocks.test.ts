import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
import { bookingClockNote, clockChangeLabel, dayClocks } from './dayClocks';
import { buildLiveDays } from './liveDays';
import { activityNodeKey, buildTripView, transitBoundaryKey } from './tripModel';
import type { Activity, Day, Place, TripData } from './types';

const DENVER = { id: 'p_den', label: 'Denver', timeZone: 'America/Denver' };
const PAGE = { id: 'p_page', label: 'Page', timeZone: 'America/Phoenix' };

function trip(): TripData {
  return {
    trip: { _id: 'trip_t', name: 'Trip', travelers: [], images: [] },
    legs: [{ _id: 'leg_t', tripId: 'trip_t', name: 'Leg', skeletonAuthority: 'self', images: [] }],
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

function activity(
  id: string,
  startAt: string,
  place: Place | null = null,
  scenarioId: string | null = null,
): Activity {
  return {
    _id: id,
    legId: 'leg_t',
    scenarioId,
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
    text: id,
    place,
    bookingId: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
  };
}

function dayOf(data: TripData, date: string): Day {
  const view = buildTripView(data, TEST_TODAY);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: new Map(),
    routeTones: new Map(),
    mealOptionIndex: new Map(),
  });
  return days.find((d) => d.date === date)!;
}

describe('a day’s clocks', () => {
  it('marks where a drive crosses a zone line, and names both clocks', () => {
    // Leaves Denver 21:00 MDT, reaches Page 21:30 MST: the clocks go back an hour.
    const data = trip();
    data.transits.push({
      _id: 't1',
      legId: 'leg_t',
      journeyId: null,
      travelers: null,
      scenarioId: null,
      mode: 'drive',
      from: DENVER,
      to: PAGE,
      departsAt: '2027-06-28T21:00',
      arrivesAt: '2027-06-28T21:30',
      routeId: null,
      routeVariant: null,
      bookingId: null,
      images: [],
    });
    const { names, changes } = dayClocks(dayOf(data, '2027-06-28'));
    expect(names).toEqual(['MDT', 'MST']);
    expect([...changes]).toEqual([
      [transitBoundaryKey('t1', 'arrive'), { minutes: -60, from: 'MDT', to: 'MST' }],
    ]);
  });

  it('marks nothing on a day on one clock', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T09:00', DENVER),
      activity('b', '2027-06-28T12:00', DENVER),
    );
    const { names, changes } = dayClocks(dayOf(data, '2027-06-28'));
    expect(names).toEqual(['MDT']);
    expect(changes.size).toBe(0);
  });

  it('names each clock the day moves onto, back again included', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T09:00', PAGE),
      activity('b', '2027-06-28T12:00', DENVER),
      activity('c', '2027-06-28T18:00', PAGE),
    );
    expect(dayClocks(dayOf(data, '2027-06-28')).names).toEqual(['MST', 'MDT', 'MST']);
  });

  it('marks only a clock that moves, though it names both zones on the same time', () => {
    // In summer Phoenix (MST) and Los Angeles (PDT) are both seven hours behind UTC.
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T09:00', PAGE),
      activity('b', '2027-06-28T12:00', {
        id: 'p_la',
        label: 'LA',
        timeZone: 'America/Los_Angeles',
      }),
    );
    const { names, changes } = dayClocks(dayOf(data, '2027-06-28'));
    expect(names).toEqual(['MST', 'PDT']);
    expect(changes.size).toBe(0);
  });

  it('marks a move at the next row shown when a filter hides the row it lands on', () => {
    const data = trip();
    data.activities.push(
      activity('den', '2027-06-28T08:00', DENVER),
      activity('page', '2027-06-28T12:00', PAGE),
      activity('later', '2027-06-28T15:00', PAGE),
    );
    const day = dayOf(data, '2027-06-28');
    const hidePage = (list: typeof day.rows) =>
      list.filter((row) => row.type !== 'activity' || row.activity._id !== 'page');
    expect([...dayClocks(day, hidePage).changes.keys()]).toEqual([activityNodeKey('later')]);
  });

  it('marks a crossing inside a scenario’s branch once, where the branch makes it', () => {
    // Denver, then the ideal branch in Page, then Page again after the box.
    const data = trip();
    data.scenarios.push(
      {
        _id: 'sc_ideal',
        legId: 'leg_t',
        tone: 'ideal',
        label: 'Ideal',
        icon: 'flight_takeoff',
        images: [],
      },
      { _id: 'sc_alt', legId: 'leg_t', tone: 'alternate', label: 'Alt', icon: 'cloud', images: [] },
    );
    data.activities.push(
      activity('before', '2027-06-28T08:00', DENVER),
      activity('ideal', '2027-06-28T12:00', PAGE, 'sc_ideal'),
      activity('alt', '2027-06-28T12:00', DENVER, 'sc_alt'),
      activity('after', '2027-06-28T18:00', PAGE),
    );
    const { names, changes } = dayClocks(dayOf(data, '2027-06-28'));
    expect(names).toEqual(['MDT', 'MST']);
    expect([...changes.keys()]).toEqual([activityNodeKey('ideal')]);
  });

  it('reads a row with no zone on the trip’s clock', () => {
    // The day before is in Page, so a zone-less day after it is on Page's clock.
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-27T09:00', PAGE),
      activity('b', '2027-06-28T12:00'),
    );
    expect(dayClocks(dayOf(data, '2027-06-28')).names).toEqual(['MST']);
  });

  it('names no clock in a trip with no zones', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-06-28T09:00'));
    expect(dayClocks(dayOf(data, '2027-06-28'))).toEqual({
      names: [],
      changes: new Map(),
      unzoned: [],
    });
  });

  it('reads a zone the browser doesn’t know on the trip’s clock', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-27T09:00', PAGE),
      activity('b', '2027-06-28T10:00', { id: 'p_x', label: 'X', timeZone: 'Mars/Olympus' }),
    );
    expect(dayClocks(dayOf(data, '2027-06-28')).names).toEqual(['MST']);
  });

  it('marks a daylight-saving change on one clock, naming both sides', () => {
    // Denver leaves daylight time at 02:00 on Nov 7 2027.
    const data = trip();
    data.activities.push(
      activity('a', '2027-11-07T01:00', DENVER),
      activity('b', '2027-11-07T09:00', DENVER),
    );
    const { names, changes } = dayClocks(dayOf(data, '2027-11-07'));
    expect(names).toEqual(['MDT', 'MST']);
    expect(changes.get(activityNodeKey('b'))).toEqual({ minutes: -60, from: 'MDT', to: 'MST' });
  });

  it('says which way the clocks go, and by how much', () => {
    const change = (minutes: number) => clockChangeLabel({ minutes, from: 'a', to: 'b' });
    expect(change(-60)).toBe('Clocks go back 1 hour');
    expect(change(120)).toBe('Clocks go forward 2 hours');
    expect(change(30)).toBe('Clocks go forward 30 min');
  });
});

describe('places with no zone recorded on a routed drive', () => {
  it('leaves out the Route’s stops and ends, which no entry’s edit form re-picks', () => {
    const data = trip();
    const a = { id: 'p_a', label: 'Town A' };
    const b = { id: 'p_b', label: 'Town B' };
    data.routes.push({
      _id: 'r1',
      from: a,
      to: b,
      variants: [
        {
          tone: 'direct',
          label: 'Direct',
          places: [
            { kind: 'waypoint', place: { id: 'p_stop', label: 'Stop' }, travel: { minutes: 30 } },
          ],
          finalTravel: { minutes: 30 },
        },
      ],
      images: [],
    } as never);
    data.transits.push({
      _id: 't1',
      legId: 'leg_t',
      journeyId: null,
      travelers: null,
      scenarioId: null,
      mode: 'drive',
      from: a,
      to: b,
      departsAt: '2027-06-28T09:00',
      arrivesAt: null,
      routeId: 'r1',
      routeVariant: null,
      bookingId: null,
      images: [],
    });
    data.activities.push(activity('cafe', '2027-06-28T12:00', { id: 'p_cafe', label: 'Cafe' }));
    expect(dayClocks(dayOf(data, '2027-06-28')).unzoned).toEqual(['Cafe']);
  });
});

describe('a meal still choosing', () => {
  it('reads on its own clock, as the day list orders it, whichever candidate is picked', () => {
    const data = trip();
    data.activities.push(activity('den', '2027-06-28T08:00', DENVER), {
      ...activity('lunch', '2027-06-28T12:00'),
      mealType: 'lunch',
      options: [
        { _id: 'o1', diningFormat: 'sit-down', place: PAGE, includedIn: null, bookingId: null },
      ],
    });
    expect(dayClocks(dayOf(data, '2027-06-28')).changes.size).toBe(0);
  });
});

describe('a ship’s venue', () => {
  it('keeps the booking’s clock, the ship’s, whatever zone the venue was picked in', () => {
    const JUNEAU = { id: 'p_jnu', label: 'Juneau', timeZone: 'America/Juneau' };
    const venue = { id: 'p_grill', label: 'Grill', onboard: true, timeZone: 'America/Los_Angeles' };
    const data = trip();
    data.activities.push(activity('port', '2027-06-28T08:00', JUNEAU), {
      ...activity('dinner', '2027-06-28T18:00', venue),
      clockZone: 'America/Juneau',
    });
    expect(dayClocks(dayOf(data, '2027-06-28')).changes.size).toBe(0);
  });
});

describe('a booking on its own clock', () => {
  it('doesn’t read as the clocks moving where the trip is', () => {
    // A tour sold on Denver time at a place on Phoenix time, between two Page stops.
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T08:00', PAGE),
      { ...activity('tour', '2027-06-28T11:00', PAGE), clockZone: 'America/Denver' },
      activity('c', '2027-06-28T15:00', PAGE),
    );
    const { names, changes } = dayClocks(dayOf(data, '2027-06-28'));
    expect(names).toEqual(['MST']);
    expect(changes.size).toBe(0);
  });

  it('doesn’t move the clocks for a stay booked on another clock either', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-06-28T10:00', PAGE));
    data.stays.push({
      _id: 's1',
      legId: 'leg_t',
      scenarioId: null,
      checkInAt: '2027-06-28T15:00',
      checkOutAt: '2027-06-30T11:00',
      clockZone: 'America/Denver',
      lodging: { place: { id: 'p_lodge', label: 'Lodge', timeZone: 'America/Phoenix' } },
      bookingId: null,
      images: [],
    });
    expect(dayClocks(dayOf(data, '2027-06-28')).changes.size).toBe(0);
  });

  it('says what its time is where it is', () => {
    expect(bookingClockNote('2027-06-28T10:00', 'America/Denver', 'America/Phoenix')).toBe(
      'Booked on MDT · 9:00am MST here',
    );
  });

  it('says nothing when the clocks agree, or the place’s isn’t known', () => {
    expect(bookingClockNote('2027-06-28T10:00', 'America/Phoenix', 'America/Phoenix')).toBeNull();
    expect(bookingClockNote('2027-06-28T10:00', 'America/Denver', null)).toBeNull();
  });
});

describe('places with no zone recorded', () => {
  it('lists the day’s places with an id but no zone, not a ship’s venue or a place with no id', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T08:00', { id: 'p_term', label: 'Cruise terminal' }),
      activity('b', '2027-06-28T09:00', { id: 'p_deck', label: 'Lido deck', onboard: true }),
      activity('c', '2027-06-28T10:00', { id: null, label: 'Somewhere' }),
      activity('d', '2027-06-28T11:00', PAGE),
    );
    expect(dayClocks(dayOf(data, '2027-06-28')).unzoned).toEqual(['Cruise terminal']);
  });

  it('lists two places with the same name once each', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-06-28T08:00', { id: 'p_vc1', label: 'Visitor Center' }),
      activity('b', '2027-06-28T12:00', { id: 'p_vc2', label: 'Visitor Center' }),
    );
    expect(dayClocks(dayOf(data, '2027-06-28')).unzoned).toEqual([
      'Visitor Center',
      'Visitor Center',
    ]);
  });
});
