import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
import {
  bookingFormValueFrom,
  hasVaryingFares,
  paymentDueError,
  readBookingFormValue,
} from './bookingFormValue';
import {
  bookingCost,
  bookingReferrers,
  faresByTraveler,
  finalPaymentDue,
  fixedCost,
  perTravelerCost,
  travelerPrices,
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
    const { budget } = buildTripView(roundTripData(), TEST_TODAY);
    expect(budget.totals.spent).toBeCloseTo(500.3);
    expect(budget.byDay.map((g) => g.day.date)).toEqual(['2027-07-08']);
    expect(budget.byDay[0].rows[0].label).toContain(' + ');
  });

  it('credits each traveler exactly their own fare', () => {
    const { budget } = buildTripView(roundTripData(), TEST_TODAY);
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
    const view = buildTripView(roundTripData(), TEST_TODAY);
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
  it('keeps each payment line, its date included, on Save when two are already paid', () => {
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
            payable: { paidAt: '2026-10-16' },
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

describe('booking form: payments due', () => {
  const party = ['t_a', 't_b'];
  const withBalance = {
    ...bookingFormValueFrom(null),
    status: 'booked' as const,
    perPersonAmount: '675',
    payable: { paidAt: '2026-10-16' },
    paymentsDue: [{ key: 'k', amount: '2025', dueBy: '2027-05-01' }],
  };
  const balanceLines = [
    { travelerId: 't_a', fare: usd(675), payable: { paidAt: '2026-10-16' } },
    { travelerId: 't_a', fare: usd(2025), payable: { dueBy: '2027-05-01' } },
    { travelerId: 't_b', fare: usd(675), payable: { paidAt: '2026-10-16' } },
    { travelerId: 't_b', fare: usd(2025), payable: { dueBy: '2027-05-01' } },
  ];

  it('adds each payment due to every traveler’s fare, due by its date', () => {
    const booking = readBookingFormValue(withBalance, party);
    expect(booking?.pricing?.perTraveler).toEqual(balanceLines);
    expect(booking?.pricing?.fixed).toEqual([]);
    expect(bookingCost(booking)).toEqual(usd(5400));
    expect(finalPaymentDue(booking)).toBe('2027-05-01');
  });

  it('reads the payments due back as rows and saves them unchanged', () => {
    const saved = readBookingFormValue(withBalance, party)!;
    const value = bookingFormValueFrom(saved);
    expect(value.perPersonAmount).toBe('675');
    expect(value.payable).toEqual({ paidAt: '2026-10-16' });
    expect(value.paymentsDue).toMatchObject([{ amount: '2025', dueBy: '2027-05-01' }]);
    expect(readBookingFormValue(value, [])?.pricing).toEqual(saved.pricing);
  });

  it('keeps each traveler’s ticket number on their own fare', () => {
    const base: Booking = {
      _id: 'b_t',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: balanceLines.map((l) =>
          l.payable.paidAt ? { ...l, ticketNumber: `tkt-${l.travelerId}` } : l,
        ),
        fixed: [],
      },
    };
    expect(readBookingFormValue(bookingFormValueFrom(base), [])?.pricing).toEqual(base.pricing);
  });

  it('drops the payment due once its row is removed', () => {
    const saved = readBookingFormValue(withBalance, party)!;
    const value = { ...bookingFormValueFrom(saved), paymentsDue: [] };
    expect(readBookingFormValue(value, [])?.pricing?.perTraveler).toEqual(
      balanceLines.filter((l) => l.payable.paidAt),
    );
  });

  it('reads the earliest date as the Payment when every line is due by one', () => {
    const value = {
      ...withBalance,
      payable: { dueBy: '2027-01-01' },
      paymentsDue: [
        { key: 'a', amount: '100', dueBy: '2027-06-01' },
        { key: 'b', amount: '200', dueBy: '2027-05-01' },
      ],
    };
    const saved = readBookingFormValue(value, party)!;
    const reread = bookingFormValueFrom(saved);
    expect(reread.payable).toEqual({ dueBy: '2027-01-01' });
    expect(reread.paymentsDue).toMatchObject([
      { amount: '200', dueBy: '2027-05-01' },
      { amount: '100', dueBy: '2027-06-01' },
    ]);
    expect(bookingCost(readBookingFormValue(reread, []))).toEqual(usd(1950));
  });

  it('drops a row with no amount', () => {
    const value = { ...withBalance, paymentsDue: [{ key: 'k', amount: '', dueBy: '2027-05-01' }] };
    expect(readBookingFormValue(value, party)?.pricing?.perTraveler).toHaveLength(2);
  });

  it('leaves out a row with no date, and says to pick one', () => {
    const row = { key: 'k', amount: '2025', dueBy: '' };
    const value = { ...withBalance, paymentsDue: [row] };
    expect(paymentDueError(value, row)).toBe('Pick a date');
    expect(readBookingFormValue(value, party)?.pricing?.perTraveler).toHaveLength(2);
  });

  it('flags a row due no later than the Payment, and clears once it is later', () => {
    const value = { ...withBalance, payable: { dueBy: '2027-05-01' } };
    expect(paymentDueError(value, value.paymentsDue[0])).toBe('Pick a date after the Payment’s');
    const later = { key: 'k', amount: '2025', dueBy: '2027-05-02' };
    expect(paymentDueError({ ...value, paymentsDue: [later] }, later)).toBeNull();
    expect(paymentDueError(withBalance, withBalance.paymentsDue[0])).toBeNull();
  });

  it('saves payments due only alongside a per-person amount', () => {
    const value = { ...withBalance, perPersonAmount: '' };
    expect(readBookingFormValue(value, party)?.pricing).toBeNull();
  });

  it('keeps a ticket number stored on a balance line', () => {
    const base: Booking = {
      _id: 'b_tb',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: balanceLines.map((l) =>
          l.payable.dueBy ? { ...l, ticketNumber: `tkt-${l.travelerId}` } : l,
        ),
        fixed: [],
      },
    };
    const saved = readBookingFormValue(bookingFormValueFrom(base), [])!;
    expect(travelerPrices(saved).map((t) => t.ticketNumber)).toEqual(['tkt-t_a', 'tkt-t_b']);
  });

  it('keeps an undated deposit and its balance beside a fee paid at the property', () => {
    const base: Booking = {
      _id: 'b_mix',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: [
          { travelerId: 't_a', fare: usd(100) },
          { travelerId: 't_a', fare: usd(900), payable: { dueBy: '2027-04-18' } },
        ],
        fixed: [{ label: 'Port fees', amount: usd(50), payable: 'atProperty' }],
      },
    };
    const value = bookingFormValueFrom(base);
    expect(value.perPersonAmount).toBe('100');
    expect(value.paymentsDue).toMatchObject([{ amount: '900', dueBy: '2027-04-18' }]);
    expect(readBookingFormValue(value, [])?.pricing).toEqual(base.pricing);
  });

  it('leaves fares that differ by traveler as they are, payments due and all', () => {
    const base: Booking = {
      _id: 'b_v',
      status: 'booked',
      confirmationNumber: null,
      pricing: {
        perTraveler: [
          { travelerId: 't_a', fare: usd(50), payable: { paidAt: '2026-08-06' } },
          { travelerId: 't_a', fare: usd(3000), payable: { dueBy: '2027-04-18' } },
          { travelerId: 't_b', fare: usd(50), payable: { paidAt: '2026-08-06' } },
          { travelerId: 't_b', fare: usd(1000), payable: { dueBy: '2027-04-18' } },
        ],
        fixed: [],
      },
    };
    const value = bookingFormValueFrom(base);
    expect(hasVaryingFares(value)).toBe(true);
    expect(value.paymentsDue).toEqual([]);
    const edited = { ...value, paymentsDue: [{ key: 'k', amount: '5', dueBy: '2027-05-01' }] };
    expect(readBookingFormValue(edited, [])?.pricing).toEqual(base.pricing);
  });
});

describe('booking form: booked through', () => {
  const base: Booking = {
    _id: 'b_seller',
    status: 'booked',
    confirmationNumber: 'ABC',
    pricing: null,
    bookedThrough: { name: 'Expedia', confirmationNumber: '7261' },
  };

  it('keeps the seller’s own confirmation number while its name is unchanged', () => {
    const value = bookingFormValueFrom(base);
    expect(value.bookedThrough).toBe('Expedia');
    expect(readBookingFormValue(value, [])?.bookedThrough).toEqual(base.bookedThrough);
    expect(
      readBookingFormValue({ ...value, bookedThrough: ' expedia ' }, [])?.bookedThrough,
    ).toEqual({ name: 'expedia', confirmationNumber: '7261' });
  });

  it('drops that number for a different seller, and the seller once cleared', () => {
    const value = bookingFormValueFrom(base);
    expect(readBookingFormValue({ ...value, bookedThrough: 'Viator' }, [])?.bookedThrough).toBe(
      'Viator',
    );
    expect(readBookingFormValue({ ...value, bookedThrough: ' ' }, [])).not.toHaveProperty(
      'bookedThrough',
    );
  });
});
