import { describe, expect, it } from 'vitest';

import type { QueuedImport } from '../model/documentImport';
import { blankPackage, blankTransit } from '../model/editForms';
import type { Booking, Transit, TripData } from '../model/types';
import {
  checkDocument,
  type GoldenDocument,
  matches,
  placeholderData,
  saveQueue,
} from './goldenCheck';

const usd = (amount: number) => ({ amount, currency: 'USD' });

function flight(overrides: Partial<Transit> = {}): Transit {
  return {
    ...blankTransit('leg_t', '2027-07-08'),
    _id: 'ph_flight',
    mode: 'flight',
    from: { id: 'place_a', label: 'Alpha (AAA)' },
    to: { id: 'place_b', label: 'Bravo (BBB)' },
    departsAt: '2027-07-08T09:00',
    arrivesAt: '2027-07-08T11:00',
    ...overrides,
  };
}

const booking: Booking = {
  _id: 'bk_1',
  status: 'booked',
  confirmationNumber: 'TST1',
  pricing: {
    perTraveler: [
      { travelerId: 't1', fare: usd(100), ticketNumber: '001' },
      { travelerId: 't2', fare: usd(100), ticketNumber: '002' },
    ],
    fixed: [{ label: 'Fee', amount: usd(10), payable: 'atProperty' }],
  },
};

function trip(transits: Transit[], bookings: Booking[] = []): TripData {
  return {
    trip: {
      _id: 'trip_t',
      name: 'Test',
      travelers: [
        { id: 't1', name: 'Alex Tester' },
        { id: 't2', name: 'Sam Tester' },
      ],
      images: [],
    },
    legs: [{ _id: 'leg_t', tripId: 'trip_t', name: 'Leg', skeletonAuthority: 'self', images: [] }],
    stays: [],
    transits,
    activities: [],
    scenarios: [],
    notes: [],
    bookings,
    travelModeOverrides: [],
    routes: [],
  };
}

const golden: GoldenDocument = {
  entities: {
    ph_flight: { flightNumber: 'TA 1', departsAt: '2027-07-08T08:55', 'from.id': 'place_a' },
  },
  bookings: {
    ph_flight: {
      confirmationNumber: 'TST1',
      perTraveler: [
        { travelerId: 't1', amount: 100, ticketNumber: '001' },
        { travelerId: 't2', amount: 100, ticketNumber: '002' },
      ],
      fixedTotal: 10,
      fixedPayable: 'atProperty',
    },
  },
  notes: { mention: ['nonrefundable'], avoid: ['pet'] },
};

function queued(transit: Transit, notes: string[] = ['Nonrefundable fare.']): QueuedImport {
  return {
    kind: 'transit',
    entity: transit,
    bookings: [booking],
    travelers: [],
    overrideId: transit._id,
    notes: notes.map((text) => ({
      ref: { entity: 'transit', id: transit._id },
      kind: 'info',
      text,
    })),
  };
}

describe('matches', () => {
  it('compares numbers to the cent, strings ignoring case and spacing', () => {
    expect(matches(137.4, 137.400001)).toBe(true);
    expect(matches('Room  (1 night)', 'room (1 night)')).toBe(true);
    expect(matches('2 Queen', '2 Queens')).toBe(false);
  });

  it('matches objects by the expected keys, arrays as same-length sets', () => {
    expect(matches({ id: 'p' }, { id: 'p', label: 'Place', images: [] })).toBe(true);
    expect(matches([{ seat: '1A' }, { seat: '1B' }], [{ seat: '1B' }, { seat: '1A' }])).toBe(true);
    expect(matches([{ seat: '1A' }], [{ seat: '1A' }, { seat: '1B' }])).toBe(false);
    expect(matches(null, undefined)).toBe(true);
  });
});

describe('placeholderData', () => {
  it('strips what the document supplies, keeping place and time', () => {
    const entered = flight({ flightNumber: 'TA 1', carrier: 'Test Air', bookingId: 'bk_1' });
    const data = placeholderData(trip([entered], [booking]), golden);
    const [ph] = data.transits;
    expect(ph.flightNumber).toBeUndefined();
    expect(ph.bookingId).toBeNull();
    expect(ph.from.id).toBe('place_a');
    expect(ph.departsAt).toBe('2027-07-08T09:00');
    expect(data.bookings).toEqual([]);
  });
});

describe('placeholderData and leg bookings', () => {
  it('clears a booking a leg shares with a reset entry', () => {
    const entered = flight({ bookingId: 'bk_1' });
    const data = trip([entered], [booking]);
    data.legs[0] = { ...data.legs[0], bookingId: 'bk_1' };
    const reset = placeholderData(data, golden);
    expect(reset.legs[0].bookingId).toBeNull();
    expect(reset.bookings).toEqual([]);
  });
});

describe('checkDocument', () => {
  const before = trip([flight()]);

  it('passes when the saved result is what a person entered', () => {
    const imported = flight({
      flightNumber: 'TA 1',
      departsAt: '2027-07-08T08:55',
      bookingId: 'bk_1',
    });
    const { data, notes } = saveQueue(before, [queued(imported)]);
    expect(checkDocument(before, data, notes, golden)).toEqual([]);
  });

  it('reports a wrong field, an unexpected new entry, and notes it should or shouldn’t have', () => {
    const wrongTime = flight({
      flightNumber: 'TA 1',
      departsAt: '2027-07-08T09:00',
      bookingId: 'bk_1',
    });
    const duplicate = flight({ _id: 'new_flight', bookingId: 'bk_1' });
    const { data, notes } = saveQueue(before, [
      queued(wrongTime, ['Pets allowed for a fee.']),
      queued(duplicate, []),
    ]);
    const where = checkDocument(before, data, notes, golden).map((f) => f.where);
    expect(where).toEqual(
      expect.arrayContaining([
        expect.stringContaining('departsAt'),
        'unexpected new transit',
        'notes',
      ]),
    );
    expect(where.filter((w) => w === 'notes')).toHaveLength(2);
    expect(
      checkDocument(before, data, notes, { ...golden, notes: { mention: ['cancel|pets'] } }),
    ).not.toContainEqual(expect.objectContaining({ where: 'notes' }));
  });

  it('compares package totals at their charged count, however the lines are split', () => {
    const fees = flight({ bookingId: 'bk_1', flightNumber: 'TA 1', departsAt: '2027-07-08T08:55' });
    fees.packages = [
      { ...blankPackage(), name: 'Fee', cost: usd(9), payable: 'atProperty' },
      { ...blankPackage(), name: 'Tax', cost: usd(1), payable: 'atProperty' },
    ];
    const { data, notes } = saveQueue(before, [queued(fees)]);
    const expectTotal = (total: number) =>
      checkDocument(before, data, notes, {
        ...golden,
        packageTotals: { ph_flight: { total, payable: 'atProperty' } },
      });
    expect(expectTotal(10)).toEqual([]);
    expect(expectTotal(12)).toEqual([
      { where: 'ph_flight packages total', expected: 12, actual: 10 },
    ]);
  });

  it('checks totals overall and per traveler across the bookings, however split', () => {
    const imported = flight({
      flightNumber: 'TA 1',
      departsAt: '2027-07-08T08:55',
      bookingId: 'bk_1',
    });
    const { data, notes } = saveQueue(before, [queued(imported)]);
    const totals = (total: number, t1: number) =>
      checkDocument(before, data, notes, {
        ...golden,
        totals: { total, perTraveler: { t1 } },
      });
    expect(totals(210, 100)).toEqual([]);
    expect(totals(200, 90).map((f) => f.where)).toEqual(['totals total', 'totals t1']);
  });

  it('reports a booking whose fixed charges are paid at the wrong time', () => {
    const imported = flight({
      flightNumber: 'TA 1',
      departsAt: '2027-07-08T08:55',
      bookingId: 'bk_1',
    });
    const paidNow: Booking = {
      ...booking,
      pricing: { ...booking.pricing!, fixed: [{ label: 'Fee', amount: usd(10) }] },
    };
    const { data, notes } = saveQueue(before, [{ ...queued(imported), bookings: [paidNow] }]);
    expect(checkDocument(before, data, notes, golden)).toEqual([
      { where: 'ph_flight booking fixedPayable', expected: 'atProperty', actual: 'paid' },
    ]);
  });
});
