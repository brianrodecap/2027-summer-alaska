import { describe, expect, it } from 'vitest';

import { bookingFormValueFrom, readBookingFormValue } from './bookingFormValue';
import {
  bookingCost,
  bookingReferrers,
  faresByTraveler,
  finalPaymentDue,
  fixedCost,
  perTravelerCost,
  withoutOrphanBookings,
} from './bookings';
import { blankActivity, blankTransit, commitEntityEdit, deleteEntityByKind } from './editForms';
import { buildTripView, tripBookingSummary } from './tripModel';
import type { Booking, Transit, TripData } from './types';

const usd = (amount: number) => ({ amount, currency: 'USD' });

function tripData(overrides: Partial<TripData> = {}): TripData {
  return {
    trip: {
      _id: 'trip_test',
      name: 'Test Trip',
      travelers: [
        { id: 't_a', name: 'Alex Test' },
        { id: 't_b', name: 'Sam Test' },
      ],
      images: [],
    },
    legs: [
      {
        _id: 'leg_test',
        tripId: 'trip_test',
        name: 'Test Leg',
        skeletonAuthority: 'self',
        images: [],
      },
    ],
    stays: [],
    transits: [],
    activities: [],
    bookings: [],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
    ...overrides,
  };
}

function flight(
  id: string,
  departsAt: string,
  arrivesAt: string,
  bookingId: string | null,
): Transit {
  return {
    ...blankTransit('leg_test', departsAt.slice(0, 10)),
    _id: id,
    mode: 'flight',
    from: { id: null, label: id.endsWith('out') ? 'Home (HOM)' : 'Away (AWY)' },
    to: { id: null, label: id.endsWith('out') ? 'Away (AWY)' : 'Home (HOM)' },
    departsAt,
    arrivesAt,
    bookingId,
  };
}

// One ticket, itemized per traveler, covering both flights of a round trip.
const roundTrip: Booking = {
  _id: 'booking_rt',
  status: 'booked',
  pricing: {
    perTraveler: [
      { travelerId: 't_a', fare: usd(300.1), ticketNumber: '001' },
      { travelerId: 't_b', fare: usd(200.2), ticketNumber: '002' },
    ],
    fixed: [],
  },
  confirmationNumber: 'RT1234',
};

function roundTripData(): TripData {
  return tripData({
    transits: [
      flight('flight_out', '2027-07-08T08:00', '2027-07-08T10:00', 'booking_rt'),
      flight('flight_back', '2027-07-10T18:00', '2027-07-10T20:00', 'booking_rt'),
    ],
    bookings: [roundTrip],
  });
}

describe('bookingCost', () => {
  it('sums per-traveler fares to the cent rather than storing a total', () => {
    expect(bookingCost(roundTrip)).toEqual(usd(500.3));
  });

  it('sums fixed charges with the fares, and is null when unpriced', () => {
    const fixed: Booking = {
      ...roundTrip,
      pricing: { perTraveler: [], fixed: [{ label: 'Room', amount: usd(80) }] },
    };
    expect(bookingCost(fixed)).toEqual(usd(80));
    expect(bookingCost({ ...roundTrip, pricing: null })).toBeNull();
    const both: Booking = {
      ...roundTrip,
      pricing: { ...roundTrip.pricing!, fixed: [{ label: 'Fee', amount: usd(9.7) }] },
    };
    expect(bookingCost(both)).toEqual(usd(510));
    expect(perTravelerCost(both)).toEqual(usd(500.3));
    expect(fixedCost(both)).toEqual(usd(9.7));
  });
});

describe('a booking shared by two flights', () => {
  it('lists both flights as referrers', () => {
    expect(
      bookingReferrers(roundTripData(), 'booking_rt').map(({ kind, id }) => ({ kind, id })),
    ).toEqual([
      { kind: 'transit', id: 'flight_out' },
      { kind: 'transit', id: 'flight_back' },
    ]);
  });

  it('is counted once in the budget, on the first flight’s day, labeled with both', () => {
    const { budget } = buildTripView(roundTripData());
    expect(budget.totals.spent).toBeCloseTo(500.3);
    expect(budget.byDay.map((g) => g.day.date)).toEqual(['2027-07-08']);
    expect(budget.byDay[0].rows[0].label).toContain(' + ');
  });

  it('credits each traveler exactly their own fare', () => {
    const { budget } = buildTripView(roundTripData());
    const byName = Object.fromEntries(budget.byTraveler.map((g) => [g.name, g.totals.spent]));
    expect(byName['Alex Test']).toBeCloseTo(300.1);
    expect(byName['Sam Test']).toBeCloseTo(200.2);
  });

  it('counts once toward booking progress', () => {
    const data = roundTripData();
    data.bookings = [{ ...roundTrip, status: 'planning' }];
    data.transits.push(
      flight('flight_x_out', '2027-07-09T08:00', '2027-07-09T09:00', 'booking_other'),
    );
    data.bookings.push({ ...roundTrip, _id: 'booking_other', status: 'booked' });
    // Two bookings, one booked — 50%, not 33% from counting the shared one twice.
    expect(tripBookingSummary(data.legs, data).percent).toBe(50);
  });

  it('counts a still-open meal candidate’s reservation toward its leg’s progress', () => {
    const data = roundTripData();
    data.activities.push({
      ...blankActivity('leg_test', '2027-07-09', null),
      _id: 'dinner',
      mealType: 'dinner',
      options: [
        {
          _id: 'opt_a',
          diningFormat: 'sit-down',
          place: { id: null, label: 'Somewhere' },
          includedIn: null,
          bookingId: 'booking_res',
        },
      ],
    });
    data.bookings.push({ ...roundTrip, _id: 'booking_res', status: 'planning', pricing: null });
    // The round trip is booked, the dinner reservation isn't — 50%.
    expect(tripBookingSummary(data.legs, data).percent).toBe(50);
  });

  it('is enriched onto each flight', () => {
    const view = buildTripView(roundTripData());
    expect(view.transitsById.get('flight_back')?.booking?._id).toBe('booking_rt');
  });
});

describe('committing edits', () => {
  it('writes the booking once, so an edit from one flight reaches the other', () => {
    const data = roundTripData();
    const outbound = structuredClone(data.transits[0]);
    const edited: Booking = { ...roundTrip, confirmationNumber: 'RT9999' };
    const next = commitEntityEdit(data, 'transit', outbound, [edited]);
    expect(next.bookings).toHaveLength(1);
    expect(next.bookings[0].confirmationNumber).toBe('RT9999');
  });

  it('drops a booking once nothing points at it any more', () => {
    const data = roundTripData();
    const cleared = data.transits.map((t) => ({ ...t, bookingId: null }));
    const next = withoutOrphanBookings(
      commitEntityEdit({ ...data, transits: cleared.slice(1) }, 'transit', cleared[0], []),
    );
    expect(next.bookings).toEqual([]);
  });

  it('keeps a shared booking when only one of its flights is deleted', () => {
    const afterOne = withoutOrphanBookings(
      deleteEntityByKind(roundTripData(), 'transit', 'flight_out'),
    );
    expect(afterOne.bookings.map((b) => b._id)).toEqual(['booking_rt']);
    const afterBoth = withoutOrphanBookings(deleteEntityByKind(afterOne, 'transit', 'flight_back'));
    expect(afterBoth.bookings).toEqual([]);
  });

  it('leaves the array untouched when there are no orphans', () => {
    const data = roundTripData();
    expect(withoutOrphanBookings(data)).toBe(data);
  });
});

describe('booking form: when the price is paid', () => {
  it('writes the chosen payment timing onto the lines it edits', () => {
    const value = {
      ...bookingFormValueFrom(null),
      status: 'booked' as const,
      fixedAmount: '100',
      payable: 'atProperty' as const,
    };
    expect(readBookingFormValue(value, ['t_a'])?.pricing?.fixed[0].payable).toBe('atProperty');
  });

  it('leaves lines alone that were already paid at different times', () => {
    const base: Booking = {
      _id: 'b_mixed',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: [],
        fixed: [
          { label: 'Room', amount: usd(100) },
          { label: 'Resort fee', amount: usd(20), payable: 'atProperty' },
        ],
      },
    };
    const value = { ...bookingFormValueFrom(base), payable: 'atProperty' as const };
    expect(readBookingFormValue(value, [])?.pricing?.fixed).toEqual(base.pricing?.fixed);
  });

  it('reads a due date never picked as paid', () => {
    const value = {
      ...bookingFormValueFrom(null),
      status: 'booked' as const,
      perPersonAmount: '20',
      payable: { dueBy: '' },
    };
    const fare = readBookingFormValue(value, ['t_a'])?.pricing?.perTraveler[0];
    expect(fare && 'payable' in fare).toBe(false);
  });
});

describe('a deposit paid on a date', () => {
  const booking: Booking = {
    _id: 'b_dep',
    status: 'booked',
    confirmationNumber: null,
    pricing: {
      perTraveler: [
        { travelerId: 't_a', fare: usd(10), payable: { paidAt: '2026-08-06' } },
        { travelerId: 't_a', fare: usd(90), payable: { dueBy: '2027-04-18' } },
        { travelerId: 't_b', fare: usd(10), payable: { paidAt: '2026-08-06' } },
        { travelerId: 't_b', fare: usd(90), payable: { dueBy: '2027-04-18' } },
      ],
      fixed: [],
    },
  };

  it('leaves the final payment to the balance lines', () => {
    expect(finalPaymentDue(booking)).toBe('2027-04-18');
  });

  it('is still each traveler’s one fare', () => {
    expect(faresByTraveler(booking).map((f) => f.fare)).toEqual([usd(100), usd(100)]);
  });

  it('reads a paid date never picked as paid', () => {
    const value = {
      ...bookingFormValueFrom(null),
      status: 'booked' as const,
      perPersonAmount: '20',
      payable: { paidAt: '' },
    };
    const fare = readBookingFormValue(value, ['t_a'])?.pricing?.perTraveler[0];
    expect(fare && 'payable' in fare).toBe(false);
  });
});

describe('a fare paid in parts', () => {
  const booking: Booking = {
    _id: 'b',
    status: 'booked',
    confirmationNumber: null,
    pricing: {
      perTraveler: [
        { travelerId: 't1', fare: { amount: 200, currency: 'USD' }, ticketNumber: '016' },
        {
          travelerId: 't1',
          fare: { amount: 800, currency: 'USD' },
          payable: { dueBy: '2027-04-18' },
        },
        {
          travelerId: 't2',
          fare: { amount: 1000, currency: 'USD' },
          payable: { dueBy: '2027-03-01' },
        },
      ],
      fixed: [
        { label: 'Port fees', amount: { amount: 50, currency: 'USD' }, payable: 'atProperty' },
      ],
    },
  };

  it('is still one fare per traveler', () => {
    expect(faresByTraveler(booking)).toEqual([
      { travelerId: 't1', fare: { amount: 1000, currency: 'USD' }, ticketNumber: '016' },
      { travelerId: 't2', fare: { amount: 1000, currency: 'USD' }, ticketNumber: undefined },
    ]);
  });

  it('has its final payment due on the last line’s date', () => {
    expect(finalPaymentDue(booking)).toBe('2027-04-18');
    expect(finalPaymentDue({ ...booking, pricing: null })).toBeNull();
  });
});

describe('booking form: a fare paid in parts', () => {
  it('keeps each payment line, its due date included, on Save', () => {
    const booking: Booking = {
      _id: 'b',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: [
          { travelerId: 't1', fare: { amount: 1000, currency: 'USD' } },
          {
            travelerId: 't1',
            fare: { amount: 1000, currency: 'USD' },
            payable: { dueBy: '2027-04-18' },
          },
        ],
        fixed: [],
      },
    };
    const value = bookingFormValueFrom(booking);
    expect(value.perPersonAmount).toBe('');
    expect(readBookingFormValue(value, ['t1'])?.pricing?.perTraveler).toEqual(
      booking.pricing!.perTraveler,
    );
  });
});
