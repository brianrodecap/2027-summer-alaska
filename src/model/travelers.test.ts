import { describe, expect, it } from 'vitest';

import { blankActivity, blankStay, blankTransit } from './editForms';
import { formatTravelerUsage, mergeTravelers, travelerUsage } from './travelers';
import type { TripData } from './types';

// A duplicate made the way a document import makes one: "Pat Guest" is the
// same person as "Pat Tester", added because a manifest spelled it its own way.
function tripWithDuplicate(): TripData {
  const flight = {
    ...blankTransit('leg_t', '2027-07-08'),
    _id: 'tr_1',
    travelers: ['t_alex', 't_guest'],
    seats: [
      { travelerId: 't_alex', seat: '1A' },
      { travelerId: 't_guest', seat: '1B', cabin: 'Coach' },
    ],
    bookingId: 'bk_1',
  };
  const both = {
    ...blankTransit('leg_t', '2027-07-09'),
    _id: 'tr_2',
    travelers: ['t_pat', 't_guest'],
    seats: [
      { travelerId: 't_pat', seat: '2A' },
      { travelerId: 't_guest', seat: '2B', cabin: 'First' },
    ],
  };
  const untouched = { ...blankTransit('leg_t', '2027-07-10'), _id: 'tr_3', travelers: null };
  const stay = blankStay('leg_t', '2027-07-08');
  stay.packages = [
    {
      _id: 'pk_1',
      name: 'Spa',
      status: 'booked',
      cost: null,
      confirmationNumber: null,
      benefits: null,
      travelers: ['t_guest'],
    },
  ];
  return {
    trip: {
      _id: 'trip_t',
      name: 'T',
      images: [],
      travelers: [
        { id: 't_alex', name: 'Alex Tester' },
        { id: 't_pat', name: 'Pat Tester' },
        { id: 't_guest', name: 'Pat Guest', age: 40 },
      ],
    },
    legs: [],
    stays: [stay],
    transits: [flight, both, untouched],
    activities: [
      { ...blankActivity('leg_t', '2027-07-08'), _id: 'ac_1', travelers: ['t_guest', 't_pat'] },
    ],
    bookings: [
      {
        _id: 'bk_1',
        status: 'booked',
        confirmationNumber: 'C1',
        pricing: {
          kind: 'perTraveler',
          fares: [
            { travelerId: 't_alex', fare: { amount: 100, currency: 'USD' } },
            { travelerId: 't_guest', fare: { amount: 100, currency: 'USD' }, ticketNumber: '9' },
          ],
        },
      },
    ],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

describe('travelerUsage', () => {
  it('counts every place a traveler is named', () => {
    const usage = travelerUsage(tripWithDuplicate(), 't_guest');
    expect(usage).toEqual({ transits: 2, activities: 1, packages: 1, seats: 2, fares: 1 });
    expect(formatTravelerUsage(usage)).toBe(
      '2 transits · 1 activity · 1 package · 2 seats · 1 fare',
    );
  });
});

describe('mergeTravelers', () => {
  it('repoints every reference and removes the merged traveler', () => {
    const before = tripWithDuplicate();
    const after = mergeTravelers(before, 't_pat', 't_guest');
    expect(after.trip.travelers).toEqual([
      { id: 't_alex', name: 'Alex Tester' },
      { id: 't_pat', name: 'Pat Tester', age: 40 },
    ]);
    expect(after.transits[0].travelers).toEqual(['t_alex', 't_pat']);
    expect(after.transits[0].seats).toEqual([
      { travelerId: 't_alex', seat: '1A' },
      { travelerId: 't_pat', seat: '1B', cabin: 'Coach' },
    ]);
    expect(after.activities[0].travelers).toEqual(['t_pat']);
    expect(after.stays[0].packages?.[0].travelers).toEqual(['t_pat']);
    expect(after.bookings[0].pricing).toMatchObject({
      fares: [{ travelerId: 't_alex' }, { travelerId: 't_pat', ticketNumber: '9' }],
    });
    expect(travelerUsage(after, 't_guest')).toEqual({
      transits: 0,
      activities: 0,
      packages: 0,
      seats: 0,
      fares: 0,
    });
  });

  it('keeps the kept traveler’s seat when both had one on the same flight', () => {
    const after = mergeTravelers(tripWithDuplicate(), 't_pat', 't_guest');
    expect(after.transits[1].travelers).toEqual(['t_pat']);
    expect(after.transits[1].seats).toEqual([{ travelerId: 't_pat', seat: '2A', cabin: 'First' }]);
  });

  it('leaves documents that never named the merged traveler as they were', () => {
    const before = tripWithDuplicate();
    const after = mergeTravelers(before, 't_pat', 't_guest');
    expect(after.transits[2]).toBe(before.transits[2]);
  });

  it('does nothing for an unknown traveler or a merge into itself', () => {
    const before = tripWithDuplicate();
    expect(mergeTravelers(before, 't_pat', 't_nobody')).toBe(before);
    expect(mergeTravelers(before, 't_pat', 't_pat')).toBe(before);
  });
});
