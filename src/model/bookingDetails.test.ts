import { describe, expect, it } from 'vitest';

import { bookedThroughLabel, paymentSummaryLine, priceLineLabel } from './bookingDetails';
import { travelerPrices } from './bookings';
import { bookingPaymentSummary } from './tripModel';
import type { Booking } from './types';

const usd = (amount: number) => ({ amount, currency: 'USD' });
const today = '2026-10-11';

const fare: Booking = {
  _id: 'b1',
  status: 'booked',
  confirmationNumber: 'ABC123',
  pricing: {
    perTraveler: [
      { travelerId: 't1', fare: usd(50), payable: { paidAt: '2026-08-06' } },
      { travelerId: 't2', fare: usd(50), payable: { paidAt: '2026-08-06' } },
      { travelerId: 't1', fare: usd(300), payable: { dueBy: '2027-04-18' } },
      { travelerId: 't2', fare: usd(300), payable: { dueBy: '2027-04-18' } },
    ],
    fixed: [{ label: 'Port fee', amount: usd(20) }],
  },
};

const withFixed = (fixed: NonNullable<Booking['pricing']>['fixed']): Booking => ({
  ...fare,
  pricing: { perTraveler: [], fixed },
});

describe('travelerPrices', () => {
  it("groups a traveler's deposit and balance under that one traveler", () => {
    expect(travelerPrices(fare)).toEqual([
      {
        travelerId: 't1',
        lines: [
          { amount: usd(50), payable: { paidAt: '2026-08-06' } },
          { amount: usd(300), payable: { dueBy: '2027-04-18' } },
        ],
      },
      {
        travelerId: 't2',
        lines: [
          { amount: usd(50), payable: { paidAt: '2026-08-06' } },
          { amount: usd(300), payable: { dueBy: '2027-04-18' } },
        ],
      },
    ]);
  });

  it('keeps the ticket number from whichever line carries it', () => {
    const ticketed: Booking = {
      ...fare,
      pricing: {
        perTraveler: [
          { travelerId: 't1', fare: usd(10) },
          { travelerId: 't1', fare: usd(20), ticketNumber: '027' },
        ],
        fixed: [],
      },
    };
    expect(travelerPrices(ticketed)[0].ticketNumber).toBe('027');
  });

  it('is empty for an unpriced booking', () => {
    expect(travelerPrices({ ...fare, pricing: null })).toEqual([]);
  });
});

describe('bookingPaymentSummary', () => {
  it('splits a booked fare into what was paid and what is still due', () => {
    expect(bookingPaymentSummary(fare, '2027-07-17', today)).toEqual({
      spent: usd(120), // two deposits plus the port fee paid when booked
      estimated: null,
      due: [{ when: { dueBy: '2027-04-18' }, amount: usd(600) }],
    });
  });

  it('keeps each due date apart, earliest first, with at-property charges after them', () => {
    const booking = withFixed([
      { label: 'Resort fee', amount: usd(50), payable: 'atProperty' },
      { label: 'Balance', amount: usd(1000), payable: { dueBy: '2027-04-18' } },
      { label: 'Second deposit', amount: usd(500), payable: { dueBy: '2027-02-01' } },
    ]);
    expect(bookingPaymentSummary(booking, '2027-07-17', today).due).toEqual([
      { when: { dueBy: '2027-02-01' }, amount: usd(500) },
      { when: { dueBy: '2027-04-18' }, amount: usd(1000) },
      { when: 'atProperty', amount: usd(50) },
    ]);
  });

  it('owes nothing once every due date has passed', () => {
    expect(bookingPaymentSummary(fare, '2027-07-17', '2027-05-01').due).toEqual([]);
  });

  it('counts an unbooked price as an estimate, apart from recorded payments', () => {
    expect(bookingPaymentSummary({ ...fare, status: 'planning' }, '2027-07-17', today)).toEqual({
      spent: usd(100),
      estimated: usd(620),
      due: [],
    });
  });

  it('sums nothing for a cancelled booking', () => {
    expect(bookingPaymentSummary({ ...fare, status: 'cancelled' }, null, today)).toEqual({
      spent: null,
      estimated: null,
      due: [],
    });
  });
});

describe('paymentSummaryLine', () => {
  const line = (booking: Booking, date: string | null = '2027-07-17', on = today) =>
    paymentSummaryLine(booking, bookingPaymentSummary(booking, date, on));

  it('names what was paid and what is due by when', () => {
    expect(line(fare)).toBe('Paid $120.00 · Due $600.00 by Apr 18, 2027');
  });

  it('gives each due date its own amount, and the property charge no date', () => {
    const booking = withFixed([
      { label: 'Second deposit', amount: usd(500), payable: { dueBy: '2027-02-01' } },
      { label: 'Resort fee', amount: usd(50), payable: 'atProperty' },
    ]);
    expect(line(booking)).toBe('Due $500.00 by Feb 1, 2027 · Due $50.00 at the property');
  });

  it('labels an unbooked price as an estimate', () => {
    const planned = {
      ...withFixed([{ label: 'Room', amount: usd(80) }]),
      status: 'planning' as const,
    };
    expect(line(planned, null)).toBe('Estimated $80.00');
  });

  it('says a cancelled booking is cancelled instead of summing it', () => {
    expect(line({ ...fare, status: 'cancelled' })).toBe('Cancelled — not counted in the budget');
  });

  it('is null when nothing is priced', () => {
    expect(line({ ...fare, pricing: null }, null)).toBeNull();
  });
});

describe('priceLineLabel', () => {
  const label = (
    payable: Parameters<typeof priceLineLabel>[0],
    booking: Booking = fare,
    date: string | null = '2027-07-17',
    on = today,
  ) => priceLineLabel(payable, booking, date, on);

  it('names each recorded payment state', () => {
    expect(label({ paidAt: '2026-08-06' })).toBe('paid Aug 6, 2026');
    expect(label({ dueBy: '2027-04-18' })).toBe('due Apr 18, 2027');
    expect(label('atProperty')).toBe('due at the property');
    expect(label(undefined)).toBe('paid');
  });

  it('agrees with the summary once a due date has passed', () => {
    expect(label({ dueBy: '2026-09-01' })).toBe('paid');
  });

  it('reads an at-property charge as paid once its day has come', () => {
    expect(label('atProperty', fare, '2026-10-01')).toBe('paid at the property');
  });

  it('gives an unbooked line no paid state of its own', () => {
    const planned: Booking = { ...fare, status: 'planning' };
    expect(label(undefined, planned)).toBeNull();
    expect(label({ dueBy: '2027-04-18' }, planned)).toBe('due Apr 18, 2027');
    expect(label({ paidAt: '2026-08-06' }, planned)).toBe('paid Aug 6, 2026');
  });

  it('keeps only recorded payments on a cancelled booking', () => {
    const cancelled: Booking = { ...fare, status: 'cancelled' };
    expect(label({ paidAt: '2026-08-06' }, cancelled)).toBe('paid Aug 6, 2026');
    expect(label({ dueBy: '2027-04-18' }, cancelled)).toBeNull();
    expect(label(undefined, cancelled)).toBeNull();
  });
});

describe('bookedThroughLabel', () => {
  it("shows the seller, with the seller's own confirmation number when it has one", () => {
    expect(bookedThroughLabel(undefined)).toBeNull();
    expect(bookedThroughLabel('Capital One Travel')).toBe('Capital One Travel');
    expect(bookedThroughLabel({ name: 'Expedia', confirmationNumber: null })).toBe('Expedia');
    expect(bookedThroughLabel({ name: 'Expedia', confirmationNumber: '7261' })).toBe(
      'Expedia · Conf# 7261',
    );
  });
});
