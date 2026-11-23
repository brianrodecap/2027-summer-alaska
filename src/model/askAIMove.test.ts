import { describe, expect, it } from 'vitest';

import { applyMoveProposal, describeMove, parseMove } from './askAIMove';
import { applyMoveToDay, type MoveMembers } from './moveToDay';
import type { Activity, Leg, Stay, Transit, TripData } from './types';

const LEG: Leg = {
  _id: 'leg_a',
  tripId: 'trip_t',
  name: 'Parks',
  skeletonAuthority: 'self',
  images: [],
};

function activity(id: string, startAt: string): Activity {
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
  };
}

function trip(): TripData {
  const drive: Transit = {
    _id: 'drive',
    legId: 'leg_a',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    mode: 'drive',
    from: { id: 'p_a', label: 'A' },
    to: { id: 'p_b', label: 'B' },
    departsAt: '2027-07-02T13:00',
    arrivesAt: '2027-07-02T15:00',
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
  };
  const lodge: Stay = {
    _id: 'lodge',
    legId: 'leg_a',
    scenarioId: null,
    checkInAt: '2027-07-02T16:00',
    checkOutAt: '2027-07-04T11:00',
    lodging: { place: { id: 'p_l', label: 'Lodge' } },
    bookingId: null,
    images: [],
  };
  return {
    trip: { _id: 'trip_t', name: 'Trip', travelers: [], images: [] },
    legs: [LEG],
    stays: [lodge],
    transits: [drive],
    activities: [activity('walk', '2027-07-02T08:00'), activity('hike', '2027-07-03T09:00')],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    dayTitles: [{ _id: '2027-07-02', title: 'Drive day' }],
    routes: [],
  };
}

const input = (moves: unknown, extra: Record<string, unknown> = {}) => ({
  summary: 'Shift it',
  date: '2027-07-09',
  legId: 'leg_a',
  moves,
  ...extra,
});
const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return null;
};

describe('what the assistant may propose to move', () => {
  it('turns down input that is not the right shape, with an error the model can fix', () => {
    const data = trip();
    expect(message(() => parseMove(undefined, data))).toBe('"summary" is required.');
    expect(
      message(() => parseMove({ summary: 's', date: 5, legId: 'leg_a', moves: [] }, data)),
    ).toBe('"date" and "legId" are required.');
    expect(message(() => parseMove(input('walk'), data))).toBe(
      '"moves" must be a list of objects.',
    );
    expect(message(() => parseMove(input([{ activityIds: 'walk' }]), data))).toBe(
      '"activityIds" must be a list of ids.',
    );
    expect(message(() => parseMove(input([{ transitIds: [5] }]), data))).toBe(
      '"transitIds" must be a list of ids.',
    );
    expect(message(() => parseMove(input([{ activityIds: ['walk'], groupFrom: 7 }]), data))).toBe(
      '"groupFrom" must be a date string.',
    );
  });

  it('names ids that are not in the trip', () => {
    expect(
      message(() =>
        parseMove(input([{ activityIds: ['walk', 'ghost'], stayIds: ['nope'] }]), trip()),
      ),
    ).toBe('Not in this trip: ghost, nope.');
  });

  it('turns down only what applying would turn down, with the same message as the Move action', () => {
    const data = trip();
    const moves: MoveMembers[] = [{ activityIds: ['walk'], transitIds: [], stayIds: [] }];
    for (const target of [
      { date: 'Jul 9', legId: 'leg_a' },
      { date: '2027-07-09', legId: 'leg_gone' },
    ]) {
      const direct = applyMoveToDay(data, moves, target);
      expect(message(() => parseMove(input([{ activityIds: ['walk'] }], target), data))).toBe(
        'error' in direct ? direct.error : null,
      );
    }
    expect(message(() => parseMove(input([{}]), data))).toBe('Nothing to move.');
    // The same refusal as the Move action for a day that is not a date.
    for (const field of ['groupFrom', 'wholeDay']) {
      const hostile = [{ activityIds: ['walk'], [field]: 'banana' }];
      expect(message(() => parseMove(input(hostile), data))).toBe(
        'A move names a day that is not a date.',
      );
    }
  });

  it('lets a poor plan through: a past date, a booked-over day, another leg’s day', () => {
    const data = trip();
    expect(() =>
      parseMove(input([{ activityIds: ['walk'] }], { date: '2027-06-01' }), data),
    ).not.toThrow();
    expect(() =>
      parseMove(input([{ stayIds: ['lodge'] }], { date: '2027-07-03' }), data),
    ).not.toThrow();
  });
});

describe('applying a move the assistant proposed', () => {
  it('makes the same change as the Move action', () => {
    const data = trip();
    const proposal = parseMove(
      input([
        { activityIds: ['walk'], transitIds: ['drive'], stayIds: ['lodge'] },
        { activityIds: ['hike'] },
      ]),
      data,
    );
    const viaAssistant = applyMoveProposal(proposal, data, new Set([0, 1]));
    const viaAction = applyMoveToDay(data, proposal.moves, {
      date: proposal.date,
      legId: proposal.legId,
    });
    expect(viaAssistant).toEqual(viaAction);
    if (!('data' in viaAssistant)) throw new Error(viaAssistant.error);
    expect(viaAssistant.data.transits[0]).toMatchObject({
      departsAt: '2027-07-09T13:00',
      arrivesAt: '2027-07-09T15:00',
    });
    expect(viaAssistant.data.stays[0].checkOutAt).toBe('2027-07-11T11:00');
  });

  it('moves only the lines the user kept', () => {
    const data = trip();
    const proposal = parseMove(input([{ activityIds: ['walk'] }, { activityIds: ['hike'] }]), data);
    const result = applyMoveProposal(proposal, data, new Set([1]));
    if (!('data' in result)) throw new Error(result.error);
    expect(result.data.activities.map((a) => a.startAt)).toEqual([
      '2027-07-02T08:00',
      '2027-07-09T09:00',
    ]);
  });

  it('carries a whole day’s title, as the day menu does', () => {
    const data = trip();
    const proposal = parseMove(
      input([{ activityIds: ['walk'], transitIds: ['drive'], wholeDay: '2027-07-02' }]),
      data,
    );
    const result = applyMoveProposal(proposal, data, new Set([0]));
    if (!('data' in result)) throw new Error(result.error);
    expect(result.data.dayTitles).toEqual([{ _id: '2027-07-09', title: 'Drive day' }]);
  });

  it('says nothing is left to move when no line is kept', () => {
    const data = trip();
    const proposal = parseMove(input([{ activityIds: ['walk'] }]), data);
    expect(applyMoveProposal(proposal, data, new Set())).toEqual({ error: 'Nothing to move.' });
  });
});

describe('how a move reads in review', () => {
  it('names what moves, where to, and how far', () => {
    const data = trip();
    const proposal = parseMove(input([{ activityIds: ['walk'], transitIds: ['drive'] }]), data);
    expect(describeMove(proposal, data)).toEqual(['Move walk, A → B to 2027-07-09 (+7 days)']);
  });
});
