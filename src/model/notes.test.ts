import { describe, expect, it } from 'vitest';

import { blankActivity, deleteEntityByKind } from './editForms';
import { withoutOrphanNotes } from './notes';
import type { Note, Ref, TripData } from './types';

const note = (id: string, ...concerns: Ref[]): Note => ({
  _id: id,
  kind: 'info',
  text: id,
  concerns,
  images: [],
});

function tripData(notes: Note[]): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
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
    activities: [
      { ...blankActivity('leg_test', '2030-01-01'), _id: 'act_a' },
      { ...blankActivity('leg_test', '2030-01-01'), _id: 'act_b' },
    ],
    bookings: [],
    scenarios: [],
    notes,
    travelModeOverrides: [],
    routes: [],
  };
}

describe('withoutOrphanNotes', () => {
  it('drops a note whose only entity was deleted', () => {
    const data = tripData([note('n_a', { entity: 'activity', id: 'act_a' })]);
    const next = withoutOrphanNotes(data, deleteEntityByKind(data, 'activity', 'act_a'));
    expect(next.notes).toEqual([]);
  });

  it('keeps a note that still names a date or a surviving entity, minus the dangling ref', () => {
    const data = tripData([
      note('n_date', { entity: 'activity', id: 'act_a' }, { date: '2030-01-01' }),
      note('n_both', { entity: 'activity', id: 'act_a' }, { entity: 'activity', id: 'act_b' }),
    ]);
    const next = withoutOrphanNotes(data, deleteEntityByKind(data, 'activity', 'act_a'));
    expect(next.notes.map((n) => n.concerns)).toEqual([
      [{ date: '2030-01-01' }],
      [{ entity: 'activity', id: 'act_b' }],
    ]);
  });

  it('drops a note about a meal option once its activity is gone', () => {
    const data = tripData([note('n_opt', { entity: 'mealOption', id: 'opt_x' })]);
    data.activities[0].options = [
      { _id: 'opt_x', diningFormat: 'sit-down', place: null, includedIn: null, bookingId: null },
    ];
    const next = withoutOrphanNotes(data, deleteEntityByKind(data, 'activity', 'act_a'));
    expect(next.notes).toEqual([]);
  });

  it('returns the same object when the write orphaned nothing', () => {
    const data = tripData([
      note('n_a', { entity: 'activity', id: 'act_a' }),
      note('n_trip', { entity: 'trip', id: 'trip_test' }),
    ]);
    const next = deleteEntityByKind(data, 'activity', 'act_b');
    expect(withoutOrphanNotes(data, next)).toBe(next);
  });

  it('leaves refs that already dangled before the write alone', () => {
    const data = tripData([note('n_stale', { entity: 'stay', id: 'stay_gone' })]);
    const next = deleteEntityByKind(data, 'activity', 'act_a');
    expect(withoutOrphanNotes(data, next).notes).toEqual(data.notes);
  });
});
