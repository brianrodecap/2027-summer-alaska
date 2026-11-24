import { bookingById } from './bookings';
import type { Booking, DayRow } from './types';

// Whether a day's bookings are all made: 'booked' when every booking its entries point
// at is booked, 'todo' when any is still to book or only requested, null when nothing
// on the day takes a booking. Counts the plan the reader has selected, once per
// booking document, and a stay only on the day it checks in.
export type DayBookingState = 'booked' | 'todo' | null;

function bookingIdsIn(rows: DayRow[], ids: Set<string>) {
  for (const row of rows) {
    if (row.type === 'box') {
      for (const track of row.tracks) bookingIdsIn(track.rows, ids);
      continue;
    }
    // A stay's booking is the day's to make only on the day it begins: on the days
    // after it is the one already made, and on its last day it is the one slept in.
    if (row.type === 'stay' && row.relation !== 'Check in' && row.relation !== 'Overnight')
      continue;
    const entity =
      row.type === 'activity' ? row.activity : row.type === 'stay' ? row.stay : row.transit;
    if (entity.bookingId) ids.add(entity.bookingId);
  }
}

export function dayBookingState(day: { rows: DayRow[] }, bookings: Booking[]): DayBookingState {
  const ids = new Set<string>();
  bookingIdsIn(day.rows, ids);
  // A cancelled booking is not one still to make.
  const statuses = [...ids]
    .flatMap((id) => bookingById(bookings, id)?.status ?? [])
    .filter((status) => status !== 'cancelled');
  if (!statuses.length) return null;
  return statuses.every((status) => status === 'booked') ? 'booked' : 'todo';
}
