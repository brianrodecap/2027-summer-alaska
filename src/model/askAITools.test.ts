import { describe, expect, it } from 'vitest';

import { describeDay, runReadTool, ToolInputError } from './askAITools';
import { noPlaceSearches } from './proposals';
import type { Day, TripData, TripView } from './types';

// Synthetic live-day rows: only the fields describeDay reads are filled in.
const activityRow = {
  type: 'activity',
  key: 'a',
  event: {
    at: '2027-07-14T09:00',
    fuzzy: false,
    place: { id: 'place_kayak', label: 'Resurrection Bay' },
  },
  activity: {
    _id: 'act_kayak',
    text: 'Kayak tour',
    place: null,
    durationMinutes: 180,
    booking: { status: 'booked' },
  },
};

const stayRow = {
  type: 'stay',
  key: 's',
  relation: 'Check in',
  event: { at: '2027-07-14T15:00', fuzzy: false, place: null },
  stay: {
    _id: 'stay_inn',
    lodging: { place: { id: 'place_inn', label: 'Harbor Inn' } },
    booking: { status: 'requested' },
  },
};

const boxRow = {
  type: 'box',
  key: 'box',
  tracks: [
    {
      scenario: { _id: 'sc_dry', label: 'Dry day', tone: 'ideal' },
      active: true,
      rows: [
        {
          type: 'activity',
          key: 'h',
          event: { at: '2027-07-14T14:00', fuzzy: true, place: null },
          activity: { _id: 'act_hike', text: 'Exit Glacier hike', place: null },
        },
      ],
    },
    { scenario: { _id: 'sc_wet', label: 'Rainy day', tone: 'alternate' }, active: false, rows: [] },
  ],
};

const day = {
  date: '2027-07-14',
  dateLabel: 'Wed Jul 14',
  title: 'Seward',
  location: 'Seward',
  leg: { _id: 'leg_a', name: 'Kenai' },
  rows: [activityRow, stayRow, boxRow],
  notes: [],
} as unknown as Day;

const ctx = {
  data: {
    notes: [],
    activities: [],
    stays: [],
    transits: [],
    scenarios: [],
    legs: [],
    routes: [],
  } as unknown as TripData,
  view: { dateRange: { startDate: '2027-07-10', endDate: '2027-07-20' } } as TripView,
  byDate: new Map([[day.date, day]]),
  placeSearches: noPlaceSearches(),
  searchPlaces: async () => [],
};

describe('describeDay', () => {
  const text = describeDay(day);

  it('lists rows with times, ids, place ids and booking status', () => {
    expect(text).toContain(
      '9:00am Activity act_kayak: Kayak tour @ Resurrection Bay (placeId place_kayak) [180 min, booking booked]',
    );
    expect(text).toContain(
      '3:00pm Check in: Harbor Inn — Stay stay_inn @ Harbor Inn (placeId place_inn) [booking requested]',
    );
    // An activity with no tags has no empty brackets.
    expect(text).toMatch(/Exit Glacier hike$/m);
  });

  it('marks fuzzy times and shows which option is selected', () => {
    expect(text).toContain('Option sc_dry "Dry day" (ideal, currently selected):');
    expect(text).toContain('~2:00pm Activity act_hike: Exit Glacier hike');
    expect(text).toContain('Option sc_wet "Rainy day" (alternate, not selected):');
    expect(text).toContain('(entries hidden while another option is selected)');
  });
});

describe('search_places', () => {
  it('records the ids it finds, and a query that finds nothing or can’t run', async () => {
    const searches = noPlaceSearches();
    // Google's answers by query; 'Keyless' fails the way a search with no key does.
    const searchPlaces = async (query: string) => {
      if (query === 'Keyless') throw new Error('Add your Google API key in Settings.');
      return query === 'Found' ? [{ id: 'p_found', label: 'Found', address: 'Here' }] : [];
    };
    const run = (query: string) =>
      runReadTool('search_places', { query }, { ...ctx, placeSearches: searches, searchPlaces });
    expect(await run('Found')).toMatch(/placeId p_found/);
    expect(await run('Nowhere')).toBe('No places found.');
    await expect(run('Keyless')).rejects.toThrow(/Google API key/);
    expect(searches).toEqual({
      placeIds: new Set(['p_found']),
      emptyQueries: new Set(['Nowhere', 'Keyless']),
    });
  });
});

describe('runReadTool', () => {
  it('reports the trip span for a date outside it', async () => {
    await expect(runReadTool('get_day', { date: '2027-08-01' }, ctx)).rejects.toThrow(
      'the trip runs 2027-07-10 to 2027-07-20',
    );
  });

  it('rejects a missing or malformed field as a correctable input error', async () => {
    await expect(runReadTool('get_entity', {}, ctx)).rejects.toBeInstanceOf(ToolInputError);
    await expect(runReadTool('get_weather', { date: '7/14' }, ctx)).rejects.toThrow('YYYY-MM-DD');
  });

  it('returns the bookings an entity and its options reference', async () => {
    const booking = (id: string) => ({
      _id: id,
      status: 'booked',
      pricing: null,
      confirmationNumber: `CONF-${id}`,
    });
    const withBookings = {
      ...ctx,
      data: {
        ...ctx.data,
        activities: [
          {
            _id: 'act_dinner',
            bookingId: 'bk_a',
            options: [{ bookingId: 'bk_b' }, { bookingId: 'bk_a' }, { bookingId: null }],
          },
        ],
        bookings: [booking('bk_a'), booking('bk_b'), booking('bk_unused')],
      } as unknown as TripData,
    };
    const result = JSON.parse(
      (await runReadTool('get_entity', { id: 'act_dinner' }, withBookings)) as string,
    );
    expect(result.bookings.map((b: { _id: string }) => b._id)).toEqual(['bk_a', 'bk_b']);
    expect(result.bookings[0].confirmationNumber).toBe('CONF-bk_a');
  });
});
