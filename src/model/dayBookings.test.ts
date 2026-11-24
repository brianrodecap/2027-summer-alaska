import { describe, expect, it } from 'vitest';

import { dayBookingState } from './dayBookings';
import type { Booking, BookingStatus, DayRow } from './types';

const booking = (_id: string, status: BookingStatus): Booking => ({
  _id,
  status,
  pricing: null,
  confirmationNumber: null,
});

const activityRow = (bookingId: string | null) =>
  ({ type: 'activity', activity: { bookingId } }) as unknown as DayRow;
const stayRow = (bookingId: string | null, relation = 'Check in') =>
  ({ type: 'stay', relation, stay: { bookingId } }) as unknown as DayRow;
const transitRow = (bookingId: string | null) =>
  ({ type: 'transit', transit: { bookingId } }) as unknown as DayRow;
const boxRow = (...rows: DayRow[]) => ({ type: 'box', tracks: [{ rows }] }) as unknown as DayRow;

const state = (rows: DayRow[], ...bookings: Booking[]) => dayBookingState({ rows }, bookings);

describe('whether a day’s bookings are made', () => {
  it('is booked when every booking is booked', () => {
    expect(
      state([activityRow('a'), stayRow('b')], booking('a', 'booked'), booking('b', 'booked')),
    ).toBe('booked');
  });

  it('is to do when any booking is planned, or only requested', () => {
    expect(
      state([activityRow('a'), stayRow('b')], booking('a', 'booked'), booking('b', 'planning')),
    ).toBe('todo');
    expect(state([transitRow('a')], booking('a', 'requested'))).toBe('todo');
  });

  it('is nothing when nothing on the day takes a booking', () => {
    expect(state([activityRow(null), stayRow('missing')])).toBeNull();
    expect(state([])).toBeNull();
  });

  it('leaves a cancelled booking out', () => {
    expect(state([activityRow('a')], booking('a', 'cancelled'))).toBeNull();
    expect(
      state([activityRow('a'), stayRow('b')], booking('a', 'cancelled'), booking('b', 'booked')),
    ).toBe('booked');
  });

  it('counts a stay on the day it begins only', () => {
    const planning = booking('b', 'planning');
    expect(state([stayRow('b', 'Check in')], planning)).toBe('todo');
    expect(state([stayRow('b', 'Overnight')], planning)).toBe('todo');
    expect(state([stayRow('b', 'Staying')], planning)).toBeNull();
    expect(state([stayRow('b', 'Check out')], planning)).toBeNull();
  });

  it('reads the selected plan inside a scenario box', () => {
    expect(state([boxRow(activityRow('a'))], booking('a', 'planning'))).toBe('todo');
  });

  it('counts a booking shared by several entries once', () => {
    expect(state([transitRow('a'), transitRow('a')], booking('a', 'booked'))).toBe('booked');
  });
});
