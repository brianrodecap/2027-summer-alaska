import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Booking, TripData } from '../../model/types';
import { BookingDetails } from './BookingDetails';

afterEach(cleanup);

const data = {
  trip: { travelers: [{ id: 't1', name: 'Ada Lovelace' }] },
  legs: [{ _id: 'leg1', name: 'Test leg', bookingId: 'b1' }],
  stays: [{ _id: 'stay1', bookingId: 'b1', lodging: { place: { id: null, label: 'Test ship' } } }],
  transits: [],
  activities: [],
} as unknown as TripData;

vi.mock('../../state/useTripData', () => ({ useTripData: () => ({ data }) }));

const booking = (dueBy: string): Booking => ({
  _id: 'b1',
  status: 'booked',
  confirmationNumber: null,
  bookedThrough: 'Test Seller',
  pricing: {
    perTraveler: [{ travelerId: 't1', fare: { amount: 100, currency: 'USD' }, payable: { dueBy } }],
    fixed: [],
  },
});

const isOpen = () =>
  screen.getByRole('button', { name: 'Booking details' }).getAttribute('aria-expanded');

describe('BookingDetails', () => {
  it('opens on its own while money is still due', () => {
    render(<BookingDetails booking={booking('2999-01-01')} date={null} entityId="stay1" />);
    expect(isOpen()).toBe('true');
    expect(screen.getByText(/Due \$100\.00 by Jan 1, 2999/)).toBeTruthy();
  });

  it('stays collapsed once nothing is owed', () => {
    render(<BookingDetails booking={booking('2000-01-01')} date={null} entityId="stay1" />);
    expect(isOpen()).toBe('false');
  });

  it('names the seller, each traveler, and what else the booking covers', () => {
    render(<BookingDetails booking={booking('2999-01-01')} date={null} entityId="stay1" />);
    expect(screen.getByText('Booked through Test Seller')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Same booking also covers Test leg.')).toBeTruthy();
  });
});
