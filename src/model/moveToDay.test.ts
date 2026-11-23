import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
import { buildLiveDays } from './liveDays';
import {
  applyMoveToDay,
  legShiftOffer,
  movedFrom,
  type MoveMembers,
  moveNotes,
  nearestLegId,
  selectionToMove,
  shiftLegs,
  suggestedLegId,
  wholeDayMove,
} from './moveToDay';
import { buildTripView } from './tripModel';
import type { Activity, Leg, Stay, Transit, TripData } from './types';

const LEG_A: Leg = {
  _id: 'leg_a',
  tripId: 'trip_t',
  name: 'Parks',
  skeletonAuthority: 'self',
  images: [],
};
const LEG_B: Leg = { ...LEG_A, _id: 'leg_b', name: 'Cruise' };

function trip(): TripData {
  return {
    trip: { _id: 'trip_t', name: 'Trip', travelers: [], images: [] },
    legs: [LEG_A, LEG_B],
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

function activity(id: string, startAt: string | null, extra: Partial<Activity> = {}): Activity {
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

function transit(id: string, departsAt: string, arrivesAt: string | null): Transit {
  return {
    _id: id,
    legId: 'leg_a',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    mode: 'drive',
    from: { id: 'p_from', label: 'From' },
    to: { id: 'p_to', label: 'To' },
    departsAt,
    arrivesAt,
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
  };
}

function stay(id: string, checkInAt: string, checkOutAt: string, extra: Partial<Stay> = {}): Stay {
  return {
    _id: id,
    legId: 'leg_a',
    scenarioId: null,
    checkInAt,
    checkOutAt,
    lodging: { place: { id: 'p_lodge', label: 'Lodge' } },
    bookingId: null,
    images: [],
    ...extra,
  };
}

const plain = (members: Partial<MoveMembers>): MoveMembers[] => [
  { activityIds: [], transitIds: [], stayIds: [], ...members },
];
const group = (from: string, members: Partial<MoveMembers>): MoveMembers => ({
  activityIds: [],
  transitIds: [],
  stayIds: [],
  groupFrom: from,
  ...members,
});

function moved(data: TripData, moves: MoveMembers[], date: string, legId = 'leg_a') {
  const result = applyMoveToDay(data, moves, { date, legId });
  if (!('data' in result)) throw new Error(result.error);
  return result.data;
}

function activityDates(data: TripData): Record<string, string[]> {
  const view = buildTripView(data, TEST_TODAY);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: new Map(),
    routeVariantIds: new Map(),
    mealOptionIndex: new Map(),
  });
  return Object.fromEntries(
    days.map((d) => [
      d.date,
      d.rows.flatMap((r) => (r.type === 'activity' ? [r.activity._id] : [])),
    ]),
  );
}

describe('moving entries to another day', () => {
  it('keeps an activity’s time of day and shows it on the new day', () => {
    const data = trip();
    data.activities.push(
      activity('hike', '2027-07-02T14:00'),
      activity('stay_put', '2027-07-03T09:00'),
    );
    const after = moved(data, plain({ activityIds: ['hike'] }), '2027-07-03');
    expect(after.activities.find((a) => a._id === 'hike')?.startAt).toBe('2027-07-03T14:00');
    const byDay = activityDates(after);
    expect(byDay['2027-07-03']).toEqual(expect.arrayContaining(['hike', 'stay_put']));
    expect(byDay['2027-07-02'] ?? []).not.toContain('hike');
  });

  it('puts a date-only activity on the new day and leaves it date-only', () => {
    const data = trip();
    data.activities.push(
      activity('later', null, { date: '2027-07-02', timeLabel: 'Afternoon' }),
      activity('anchor', '2027-07-04T09:00'),
    );
    const after = moved(data, plain({ activityIds: ['later'] }), '2027-07-04');
    const entry = after.activities.find((a) => a._id === 'later')!;
    expect(entry.startAt).toBeNull();
    expect(entry.date).toBe('2027-07-04');
    expect(entry.timeLabel).toBe('Afternoon');
  });

  it('moves an overnight transit with its length, so it still arrives the next morning', () => {
    const data = trip();
    data.transits.push(transit('night_drive', '2027-07-02T23:00', '2027-07-03T06:30'));
    const t = moved(data, plain({ transitIds: ['night_drive'] }), '2027-07-05').transits[0];
    expect(t.departsAt).toBe('2027-07-05T23:00');
    expect(t.arrivesAt).toBe('2027-07-06T06:30');
  });

  it('moves a drive whose arrival comes from its route', () => {
    const data = trip();
    data.transits.push(transit('routed', '2027-07-02T09:00', null));
    const t = moved(data, plain({ transitIds: ['routed'] }), '2027-07-01').transits[0];
    expect(t.departsAt).toBe('2027-07-01T09:00');
    expect(t.arrivesAt).toBeNull();
  });

  it('moves a stay with its length and its port calls', () => {
    const data = trip();
    data.stays.push(
      stay('ship', '2027-07-17T15:00', '2027-07-24T07:30', {
        portCalls: [
          {
            kind: 'port',
            place: { id: 'p_j', label: 'Juneau' },
            arrivesAt: '2027-07-21T06:30',
            departsAt: '2027-07-21T16:15',
          },
          {
            kind: 'scenic',
            place: { id: 'p_g', label: 'Glacier' },
            arrivesAt: null,
            departsAt: null,
          },
        ],
      }),
    );
    const s = moved(data, plain({ stayIds: ['ship'] }), '2027-07-10', 'leg_b').stays[0];
    expect(s.checkInAt).toBe('2027-07-10T15:00');
    expect(s.checkOutAt).toBe('2027-07-17T07:30');
    expect(s.legId).toBe('leg_b');
    expect(s.portCalls?.[0]).toMatchObject({
      arrivesAt: '2027-07-14T06:30',
      departsAt: '2027-07-14T16:15',
    });
    expect(s.portCalls?.[1]).toMatchObject({ arrivesAt: null, departsAt: null });
  });

  it('joins the leg it is given and leaves its weather plan', () => {
    const data = trip();
    data.activities.push(activity('tour', '2027-07-02T10:00', { scenarioId: 'plan_a' }));
    data.transits.push({ ...transit('drive', '2027-07-02T08:00', null), scenarioId: 'plan_a' });
    const after = moved(
      data,
      plain({ activityIds: ['tour'], transitIds: ['drive'] }),
      '2027-07-10',
      'leg_b',
    );
    expect(after.activities[0]).toMatchObject({ legId: 'leg_b', scenarioId: null });
    expect(after.transits[0]).toMatchObject({ legId: 'leg_b', scenarioId: null });
  });

  it('changes only what was asked', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00'), activity('b', '2027-07-02T11:00'));
    const after = moved(data, plain({ activityIds: ['a'] }), '2027-07-03');
    expect(after.activities[1]).toBe(data.activities[1]);
    expect(after.legs).toBe(data.legs);
  });
});

describe('a move that is a poor plan still goes ahead', () => {
  it('takes any date, including one before the trip', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00'));
    expect(moved(data, plain({ activityIds: ['a'] }), '2027-06-01').activities[0].startAt).toBe(
      '2027-06-01T10:00',
    );
  });

  it('moves an entry onto the day it is already on, leaving its plan', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00', { scenarioId: 'plan_a' }));
    const entry = moved(data, plain({ activityIds: ['a'] }), '2027-07-02').activities[0];
    expect(entry.startAt).toBe('2027-07-02T10:00');
    expect(entry.scenarioId).toBeNull();
  });

  it('lands on top of another entry at the same time', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00'), activity('b', '2027-07-03T10:00'));
    const after = moved(data, plain({ activityIds: ['a'] }), '2027-07-03');
    expect(after.activities.map((a) => a.startAt)).toEqual([
      '2027-07-03T10:00',
      '2027-07-03T10:00',
    ]);
  });
});

describe('what a move turns down: only what cannot be stored', () => {
  it('turns down a target that is not a date, a leg the trip lacks, entries that are gone, and nothing', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00'));
    const one = plain({ activityIds: ['a'] });
    expect(applyMoveToDay(data, one, { date: 'Jul 3', legId: 'leg_a' })).toEqual({
      error: 'Pick a day from the calendar.',
    });
    expect(applyMoveToDay(data, one, { date: '2027-02-31', legId: 'leg_a' })).toEqual({
      error: 'Pick a day from the calendar.',
    });
    expect(applyMoveToDay(data, one, { date: '2027-07-03', legId: 'leg_gone' })).toEqual({
      error: 'That leg is not part of this trip.',
    });
    expect(
      applyMoveToDay(data, plain({ activityIds: ['ghost'] }), {
        date: '2027-07-03',
        legId: 'leg_a',
      }),
    ).toEqual({ error: 'Some of these entries no longer exist.' });
    expect(
      applyMoveToDay(data, [{ ...one[0], groupFrom: 'banana' }], {
        date: '2027-07-03',
        legId: 'leg_a',
      }),
    ).toEqual({ error: 'A move names a day that is not a date.' });
    expect(
      applyMoveToDay(data, [{ ...one[0], wholeDay: '2027-02-31' }], {
        date: '2027-07-03',
        legId: 'leg_a',
      }),
    ).toEqual({ error: 'A move names a day that is not a date.' });
    expect(applyMoveToDay(data, plain({}), { date: '2027-07-03', legId: 'leg_a' })).toEqual({
      error: 'Nothing to move.',
    });
  });
});

describe('moving a plan group', () => {
  // Jun 30: an ideal activity, an alternate activity, and an alternate overnight drive.
  const grouped = () => {
    const data = trip();
    data.activities.push(
      activity('fly', '2027-06-30T09:00', { scenarioId: 'ideal' }),
      activity('wiseman', '2027-06-30T10:00', { scenarioId: 'alt' }),
    );
    data.transits.push({
      ...transit('back', '2027-06-30T20:00', '2027-07-01T06:00'),
      scenarioId: 'alt',
    });
    return data;
  };
  const members = { activityIds: ['fly', 'wiseman'], transitIds: ['back'] };

  it('shifts every entry in every plan by the same days, keeping plans and offsets', () => {
    const after = moved(grouped(), [group('2027-06-30', members)], '2027-07-05', 'leg_b');
    const [fly, wiseman] = after.activities;
    expect(fly).toMatchObject({ startAt: '2027-07-05T09:00', scenarioId: 'ideal', legId: 'leg_b' });
    expect(wiseman).toMatchObject({ startAt: '2027-07-05T10:00', scenarioId: 'alt' });
    expect(after.transits[0]).toMatchObject({
      departsAt: '2027-07-05T20:00',
      arrivesAt: '2027-07-06T06:00',
      scenarioId: 'alt',
    });
  });

  it('keeps a member that sits on a later day the same number of days after the rest', () => {
    const data = grouped();
    data.activities.push(activity('next_day', '2027-07-01T10:00', { scenarioId: 'alt' }));
    const after = moved(
      data,
      [group('2027-06-30', { ...members, activityIds: [...members.activityIds, 'next_day'] })],
      '2027-07-05',
    );
    expect(after.activities.find((a) => a._id === 'next_day')?.startAt).toBe('2027-07-06T10:00');
  });

  it('moves a group earlier as well', () => {
    const after = moved(grouped(), [group('2027-06-30', members)], '2027-06-28');
    expect(after.activities[0].startAt).toBe('2027-06-28T09:00');
    expect(after.transits[0].arrivesAt).toBe('2027-06-29T06:00');
  });

  it('takes a plan’s own stay along', () => {
    const data = grouped();
    data.stays.push(
      stay('alt_lodge', '2027-06-30T16:00', '2027-07-01T11:00', { scenarioId: 'alt' }),
    );
    const after = moved(
      data,
      [group('2027-06-30', { ...members, stayIds: ['alt_lodge'] })],
      '2027-07-05',
    );
    expect(after.stays[0]).toMatchObject({
      checkInAt: '2027-07-05T16:00',
      checkOutAt: '2027-07-06T11:00',
      scenarioId: 'alt',
    });
  });

  it('moves single rows onto the day while the group shifts, in one move', () => {
    const data = grouped();
    data.activities.push(activity('lone', '2027-07-20T13:00'));
    const after = moved(
      data,
      [...plain({ activityIds: ['lone'] }), group('2027-06-30', members)],
      '2027-07-05',
    );
    expect(after.activities.find((a) => a._id === 'lone')?.startAt).toBe('2027-07-05T13:00');
    expect(after.activities.find((a) => a._id === 'fly')?.startAt).toBe('2027-07-05T09:00');
  });

  it('keeps an entry named by both a group and a single row with the group', () => {
    const after = moved(
      grouped(),
      [...plain({ activityIds: ['fly'] }), group('2027-06-30', members)],
      '2027-07-05',
    );
    expect(after.activities.find((a) => a._id === 'fly')?.scenarioId).toBe('ideal');
  });
});

describe('where a move starts from', () => {
  it('names the day and leg of the first entry', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00'));
    data.stays.push(stay('s', '2027-07-09T15:00', '2027-07-10T11:00', { legId: 'leg_b' }));
    expect(movedFrom(data, plain({ activityIds: ['a'] }))).toEqual({
      date: '2027-07-02',
      legId: 'leg_a',
    });
    expect(movedFrom(data, plain({ stayIds: ['s'] }))).toEqual({
      date: '2027-07-09',
      legId: 'leg_b',
    });
    expect(movedFrom(data, plain({}))).toBeNull();
  });
});

describe('the real length of a moved transit', () => {
  const DENVER = { id: 'p_den', label: 'Denver', timeZone: 'America/Denver' };

  it('is kept across a clock change, as when it is dragged', () => {
    // Leaves 22:00 and arrives 06:00 the next morning: eight hours. Moved to the
    // evening before Denver springs forward (02:00 on Mar 14), the same eight
    // hours arrive at 07:00 on the new clock.
    const data = trip();
    data.transits.push({
      ...transit('t', '2027-03-12T22:00', '2027-03-13T06:00'),
      from: DENVER,
      to: DENVER,
    });
    const t = moved(data, plain({ transitIds: ['t'] }), '2027-03-13').transits[0];
    expect(t.departsAt).toBe('2027-03-13T22:00');
    expect(t.arrivesAt).toBe('2027-03-14T07:00');
  });
});

describe('what a selection moves as', () => {
  const row = (
    activityIds: string[],
    transitIds: string[],
    stayIds: string[],
    isScenarioGroup = false,
    containerId = '2027-06-30::top',
  ) => ({ members: { activityIds, transitIds, stayIds }, isScenarioGroup, containerId });

  it('gathers single rows together, each entry once', () => {
    expect(selectionToMove([row(['a', 'b'], [], []), row(['b'], ['t'], ['s'])])).toEqual([
      { activityIds: ['a', 'b'], transitIds: ['t'], stayIds: ['s'] },
    ]);
  });

  it('keeps each plan group on its own, with the day it sits on', () => {
    expect(
      selectionToMove([
        row(['a'], [], []),
        row(['g1'], ['t1'], [], true, '2027-06-30::top'),
        row(['g2'], [], [], true, '2027-07-08::top'),
      ]),
    ).toEqual([
      { activityIds: ['a'], transitIds: [], stayIds: [] },
      { activityIds: ['g1'], transitIds: ['t1'], stayIds: [], groupFrom: '2027-06-30' },
      { activityIds: ['g2'], transitIds: [], stayIds: [], groupFrom: '2027-07-08' },
    ]);
  });

  it('is just the group when only a group is selected', () => {
    expect(selectionToMove([row(['g'], [], [], true)])).toEqual([
      { activityIds: ['g'], transitIds: [], stayIds: [], groupFrom: '2027-06-30' },
    ]);
  });
});

describe('what a move tells the person first', () => {
  const booking = (id: string, status: 'planning' | 'requested' | 'booked' | 'cancelled') => ({
    _id: id,
    status,
    pricing: null,
    confirmationNumber: null,
  });

  it('says nothing for plain, unbooked entries', () => {
    const data = trip();
    data.activities.push(activity('a', '2027-07-02T10:00', { bookingId: 'b_plan' }));
    data.bookings.push(booking('b_plan', 'planning'));
    expect(moveNotes(data, plain({ activityIds: ['a'] }))).toEqual([]);
  });

  it('says a move changes the plan, not a bought booking, for stays too', () => {
    const data = trip();
    data.activities.push(
      activity('a', '2027-07-02T10:00', { bookingId: 'b1' }),
      activity('b', '2027-07-02T11:00', { bookingId: 'b2' }),
    );
    data.stays.push(stay('s', '2027-07-02T15:00', '2027-07-03T11:00', { bookingId: 'b1' }));
    data.bookings.push(booking('b1', 'booked'), booking('b2', 'requested'));
    expect(moveNotes(data, plain({ activityIds: ['a'] }))).toEqual([
      '1 of these is booked. Moving it changes the plan, not the booking.',
    ]);
    expect(moveNotes(data, plain({ activityIds: ['a', 'b'], stayIds: ['s'] }))).toEqual([
      '3 of these are booked. Moving them changes the plan, not the bookings.',
      'Moves 1 stay too: its check-in and check-out dates shift with it.',
    ]);
  });

  it('says stays shift with a move, counting them', () => {
    const data = trip();
    data.stays.push(
      stay('s1', '2027-07-02T15:00', '2027-07-03T11:00'),
      stay('s2', '2027-07-03T15:00', '2027-07-04T11:00'),
    );
    expect(moveNotes(data, plain({ stayIds: ['s1'] }))).toEqual([
      'Moves 1 stay too: its check-in and check-out dates shift with it.',
    ]);
    expect(moveNotes(data, plain({ stayIds: ['s1', 's2'] }))).toEqual([
      'Moves 2 stays too: their check-in and check-out dates shift with them.',
    ]);
  });

  it('names the weather plans a single entry leaves, but not a plan group’s', () => {
    const data = trip();
    data.scenarios.push({
      _id: 'plan_a',
      legId: 'leg_a',
      tone: 'alternate',
      label: 'Grounded',
      icon: 'cloud',
      images: [],
    });
    data.activities.push(activity('a', '2027-07-02T10:00', { scenarioId: 'plan_a' }));
    expect(moveNotes(data, plain({ activityIds: ['a'] }))).toEqual([
      'Leaves the plan “Grounded”: it happens on the new day whichever plan is picked.',
    ]);
    expect(moveNotes(data, [group('2027-07-02', { activityIds: ['a'] })])).toEqual([
      'Moves the whole plan group (1 entry), keeping its plans and timing.',
    ]);
  });
});

describe('which leg to suggest on a day where the trip changes legs', () => {
  it('is the leg the entry is in, when that leg claims the day', () => {
    expect(suggestedLegId({ legId: 'leg_b' }, ['leg_a', 'leg_b'])).toBe('leg_b');
  });

  it('is nothing when the entry’s leg does not claim the day, or there is no entry', () => {
    expect(suggestedLegId({ legId: 'leg_c' }, ['leg_a', 'leg_b'])).toBeNull();
    expect(suggestedLegId(null, ['leg_a', 'leg_b'])).toBeNull();
  });
});

// Leg A runs Jul 2-4 (an activity each day), leg B (the cruise) Jul 6-8.
function twoLegs(): TripData {
  const data = trip();
  data.activities.push(
    activity('a1', '2027-07-02T10:00'),
    activity('a2', '2027-07-03T10:00'),
    activity('a3', '2027-07-04T10:00'),
    activity('b1', '2027-07-06T10:00', { legId: 'leg_b' }),
    activity('b2', '2027-07-08T10:00', { legId: 'leg_b' }),
  );
  return data;
}
const to = (date: string, legId = 'leg_a') => ({ date, legId });

describe('which legs a move would run into', () => {
  it('offers to shift a later leg by how far the move stretches this one', () => {
    // a1 moves to Jul 9: leg A now ends Jul 9, five days past Jul 4 and past leg B's start.
    expect(legShiftOffer(twoLegs(), plain({ activityIds: ['a1'] }), to('2027-07-09'))).toEqual([
      { legId: 'leg_b', days: 5 },
    ]);
  });

  it('offers to shift an earlier leg back when a move stretches this one earlier', () => {
    // b2 moves to Jul 1: leg B now starts Jul 1, one day before Jul 2 and over leg A's end.
    const data = twoLegs();
    expect(legShiftOffer(data, plain({ activityIds: ['b2'] }), to('2027-07-01', 'leg_b'))).toEqual([
      { legId: 'leg_a', days: -5 },
    ]);
  });

  it('counts a leg that starts on this leg’s last day as in the way', () => {
    const data = twoLegs();
    data.activities.push(activity('b0', '2027-07-04T20:00', { legId: 'leg_b' }));
    expect(legShiftOffer(data, plain({ activityIds: ['a1'] }), to('2027-07-09'))).toEqual([
      { legId: 'leg_b', days: 5 },
    ]);
  });

  it('counts an earlier leg that ends on this leg’s first day as in the way', () => {
    const data = twoLegs();
    data.activities.push(activity('a4', '2027-07-06T20:00'));
    expect(legShiftOffer(data, plain({ activityIds: ['b2'] }), to('2027-07-01', 'leg_b'))).toEqual([
      { legId: 'leg_a', days: -5 },
    ]);
  });

  it('leaves alone an earlier leg that ends before the stretched leg now starts', () => {
    const data = twoLegs();
    expect(legShiftOffer(data, plain({ activityIds: ['b2'] }), to('2027-07-05', 'leg_b'))).toEqual(
      [],
    );
  });

  it('offers nothing when the stretched leg stops short of the next one', () => {
    expect(legShiftOffer(twoLegs(), plain({ activityIds: ['a1'] }), to('2027-07-05'))).toEqual([]);
  });

  it('offers nothing when the move does not stretch the leg, even if legs already overlap', () => {
    const data = twoLegs();
    data.activities.push(activity('x', '2027-07-07T10:00'));
    expect(legShiftOffer(data, plain({ activityIds: ['a1'] }), to('2027-07-03'))).toEqual([]);
  });

  it('offers nothing for a move to a date before the trip when no leg is in the way', () => {
    expect(legShiftOffer(twoLegs(), plain({ activityIds: ['a1'] }), to('2027-06-01'))).toEqual([]);
  });

  it('offers nothing when the move cannot be stored', () => {
    expect(legShiftOffer(twoLegs(), plain({ activityIds: ['ghost'] }), to('2027-07-09'))).toEqual(
      [],
    );
  });
});

describe('shifting whole legs', () => {
  it('moves every dated entry of the named legs by whole days, and no other leg', () => {
    const data = twoLegs();
    data.transits.push({ ...transit('t', '2027-07-06T08:00', '2027-07-06T10:00'), legId: 'leg_b' });
    data.stays.push(
      stay('s', '2027-07-06T15:00', '2027-07-08T11:00', {
        legId: 'leg_b',
        portCalls: [
          {
            kind: 'port',
            place: { id: 'p_port', label: 'Port' },
            arrivesAt: '2027-07-07T08:00',
            departsAt: '2027-07-07T17:00',
          },
        ],
      }),
    );
    const after = shiftLegs(data, [{ legId: 'leg_b', days: 5 }]);
    expect(after.activities.map((a) => a.startAt)).toEqual([
      '2027-07-02T10:00',
      '2027-07-03T10:00',
      '2027-07-04T10:00',
      '2027-07-11T10:00',
      '2027-07-13T10:00',
    ]);
    expect(after.transits[0]).toMatchObject({
      departsAt: '2027-07-11T08:00',
      arrivesAt: '2027-07-11T10:00',
    });
    expect(after.stays[0]).toMatchObject({
      checkInAt: '2027-07-11T15:00',
      checkOutAt: '2027-07-13T11:00',
    });
    expect(after.stays[0].portCalls?.[0]).toMatchObject({
      arrivesAt: '2027-07-12T08:00',
      departsAt: '2027-07-12T17:00',
    });
  });

  it('shifts a date-only activity, and earlier for a negative number', () => {
    const data = trip();
    data.activities.push(activity('d', null, { date: '2027-07-06', legId: 'leg_b' }));
    expect(shiftLegs(data, [{ legId: 'leg_b', days: -2 }]).activities[0].date).toBe('2027-07-04');
  });

  it('takes the titles and date notes of the shifted leg’s own days along', () => {
    const data = twoLegs();
    data.dayTitles.push(
      { _id: '2027-07-03', title: 'Parks day' },
      { _id: '2027-07-07', title: 'Sea day' },
    );
    const note = (id: string, concerns: TripData['notes'][number]['concerns']) => ({
      _id: id,
      kind: 'info' as const,
      text: id,
      concerns,
      images: [],
    });
    data.notes.push(
      note('on', [{ date: '2027-07-06' }]),
      note('range', [{ dateRange: ['2027-07-06', '2027-07-08'] }]),
      note('across', [{ dateRange: ['2027-07-04', '2027-07-07'] }]),
      note('out', [{ dateRange: ['2027-07-07', '2027-07-14'] }]),
      note('entity', [{ entity: 'leg', id: 'leg_b' }]),
    );
    const after = shiftLegs(data, [{ legId: 'leg_b', days: 5 }]);
    expect(after.dayTitles.map((t) => [t._id, t.title]).sort()).toEqual([
      ['2027-07-03', 'Parks day'],
      ['2027-07-12', 'Sea day'],
    ]);
    const concerns = (id: string) => after.notes.find((n) => n._id === id)?.concerns;
    expect(concerns('on')).toEqual([{ date: '2027-07-11' }]);
    expect(concerns('range')).toEqual([{ dateRange: ['2027-07-11', '2027-07-13'] }]);
    expect(concerns('across')).toEqual([{ dateRange: ['2027-07-04', '2027-07-07'] }]);
    expect(concerns('out')).toEqual([{ dateRange: ['2027-07-07', '2027-07-14'] }]);
    expect(concerns('entity')).toEqual([{ entity: 'leg', id: 'leg_b' }]);
  });

  it('takes titles along after a move that stretched a leg over the shifted one', () => {
    const data = twoLegs();
    data.dayTitles.push({ _id: '2027-07-07', title: 'Sea day' });
    const members = plain({ activityIds: ['a1'] });
    const offer = legShiftOffer(data, members, to('2027-07-09'));
    const after = shiftLegs(moved(data, members, '2027-07-09'), offer, data);
    expect(after.dayTitles).toEqual([{ _id: '2027-07-12', title: 'Sea day' }]);
  });

  it('leaves a title on a day another leg also claims, and lets a shifted title replace one it lands on', () => {
    const data = twoLegs();
    data.activities.push(activity('a5', '2027-07-06T20:00'));
    data.dayTitles.push(
      { _id: '2027-07-06', title: 'Shared' },
      { _id: '2027-07-08', title: 'Cruise end' },
      { _id: '2027-07-13', title: 'Old' },
    );
    const after = shiftLegs(data, [{ legId: 'leg_b', days: 5 }]);
    expect(after.dayTitles.map((t) => [t._id, t.title]).sort()).toEqual([
      ['2027-07-06', 'Shared'],
      ['2027-07-13', 'Cruise end'],
    ]);
  });

  it('after a move plus an accepted shift, the legs no longer collide', () => {
    const data = twoLegs();
    const offer = legShiftOffer(data, plain({ activityIds: ['a1'] }), to('2027-07-09'));
    const after = shiftLegs(moved(data, plain({ activityIds: ['a1'] }), '2027-07-09'), offer);
    expect(legShiftOffer(after, plain({ activityIds: ['a2'] }), to('2027-07-03'))).toEqual([]);
    const starts = after.activities.filter((a) => a.legId === 'leg_b').map((a) => a.startAt);
    expect(starts).toEqual(['2027-07-11T10:00', '2027-07-13T10:00']);
  });
});

describe('the leg nearest a date no leg claims', () => {
  const legs = [
    { legId: 'a', range: { startDate: '2027-07-02', endDate: '2027-07-04' } },
    { legId: 'none', range: null },
    { legId: 'b', range: { startDate: '2027-07-10', endDate: '2027-07-12' } },
  ];

  it('is the one whose edge is closest, before, between or after', () => {
    expect(nearestLegId(legs, '2027-06-01')).toBe('a');
    expect(nearestLegId(legs, '2027-07-05')).toBe('a');
    expect(nearestLegId(legs, '2027-07-08')).toBe('b');
    expect(nearestLegId(legs, '2027-08-30')).toBe('b');
  });

  it('goes to the earlier leg on a tie, and is nothing when no leg has dates', () => {
    expect(nearestLegId(legs, '2027-07-07')).toBe('a');
    expect(nearestLegId([{ legId: 'x', range: null }], '2027-07-07')).toBeNull();
  });
});

describe('moving a whole day', () => {
  const note = (id: string, concerns: TripData['notes'][number]['concerns']) => ({
    _id: id,
    kind: 'info' as const,
    text: id,
    concerns,
    images: [],
  });
  const withDay = () => {
    const data = twoLegs();
    data.dayTitles.push({ _id: '2027-07-03', title: 'Parks day' });
    data.notes.push(
      note('on', [{ date: '2027-07-03' }]),
      note('other', [{ date: '2027-07-04' }]),
      note('range', [{ dateRange: ['2027-07-03', '2027-07-04'] }]),
      note('both', [{ date: '2027-07-03' }, { entity: 'leg', id: 'leg_a' }]),
    );
    return data;
  };
  const whole = (date = '2027-07-03'): MoveMembers[] =>
    plain({ activityIds: ['a2'] }).map((m) => ({ ...m, wholeDay: date }));
  const concerns = (data: TripData, id: string) => data.notes.find((n) => n._id === id)?.concerns;

  it('takes the day’s title and date notes to the target date', () => {
    const after = moved(withDay(), whole(), '2027-07-09');
    expect(after.dayTitles).toEqual([{ _id: '2027-07-09', title: 'Parks day' }]);
    expect(concerns(after, 'on')).toEqual([{ date: '2027-07-09' }]);
    expect(concerns(after, 'both')).toEqual([
      { date: '2027-07-09' },
      { entity: 'leg', id: 'leg_a' },
    ]);
    expect(concerns(after, 'other')).toEqual([{ date: '2027-07-04' }]);
    expect(concerns(after, 'range')).toEqual([{ dateRange: ['2027-07-03', '2027-07-04'] }]);
  });

  it('replaces a title already on the target date, and keeps it when the day has none', () => {
    const data = withDay();
    data.dayTitles.push({ _id: '2027-07-09', title: 'Old' });
    expect(moved(data, whole(), '2027-07-09').dayTitles).toEqual([
      { _id: '2027-07-09', title: 'Parks day' },
    ]);
    const bare = withDay();
    bare.dayTitles = [{ _id: '2027-07-09', title: 'Old' }];
    expect(moved(bare, whole(), '2027-07-09').dayTitles).toEqual([
      { _id: '2027-07-09', title: 'Old' },
    ]);
  });

  it('leaves the title and notes where they are when it is not a whole day', () => {
    const data = withDay();
    const after = moved(data, plain({ activityIds: ['a2'] }), '2027-07-09');
    expect(after.dayTitles).toEqual(data.dayTitles);
    expect(after.notes).toEqual(data.notes);
  });

  it('changes nothing about them when the day moves onto itself', () => {
    const data = withDay();
    const after = moved(data, whole(), '2027-07-03');
    expect(after.dayTitles).toEqual(data.dayTitles);
    expect(after.notes).toEqual(data.notes);
  });

  it('says the title and notes go along, only when the day has some', () => {
    const data = withDay();
    expect(moveNotes(data, whole())).toContain(
      'Takes the day’s title and notes along, replacing any title on the day you pick.',
    );
    expect(moveNotes(data, whole('2027-07-05'))).toEqual([]);
    expect(moveNotes(data, plain({ activityIds: ['a2'] }))).toEqual([]);
  });

  it('marks every part of a selection as the whole day', () => {
    const rows = [
      {
        members: { activityIds: ['a'], transitIds: [], stayIds: [] },
        isScenarioGroup: false,
        containerId: '2027-07-03',
      },
      {
        members: { activityIds: ['b'], transitIds: [], stayIds: [] },
        isScenarioGroup: true,
        containerId: '2027-07-03',
      },
    ];
    expect(wholeDayMove(rows, '2027-07-03').every((m) => m.wholeDay === '2027-07-03')).toBe(true);
    expect(wholeDayMove(rows, '2027-07-03')).toHaveLength(2);
  });
});
