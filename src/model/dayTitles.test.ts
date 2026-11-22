import { describe, expect, it } from 'vitest';

import { TEST_TODAY } from '../test/today';
import { dateTitlesOf, titleTarget, withTitle, writtenTitle } from './dayTitles';
import { buildLiveDays } from './liveDays';
import { buildTripView } from './tripModel';
import type { Activity, Day, Scenario, TripData } from './types';

function trip(): TripData {
  return {
    trip: { _id: 'trip_t', name: 'Trip', travelers: [], images: [] },
    legs: [{ _id: 'leg_t', tripId: 'trip_t', name: 'Leg', skeletonAuthority: 'self', images: [] }],
    stays: [],
    transits: [],
    activities: [],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    dayTitles: [],
    routes: [],
  };
}

function scenario(id: string, tone: Scenario['tone'], title?: string): Scenario {
  return {
    _id: id,
    legId: 'leg_t',
    tone,
    label: id,
    icon: 'cloud',
    images: [],
    ...(title && { title }),
  };
}

function activity(id: string, startAt: string, scenarioId: string | null): Activity {
  return {
    _id: id,
    legId: 'leg_t',
    scenarioId,
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    text: id,
    place: null,
    bookingId: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
  };
}

const DAY = '2027-06-30';

// Two plans on one date: ideal is selected unless a pick says otherwise.
function twoPlans(idealTitle?: string, altTitle?: string): TripData {
  const data = trip();
  data.scenarios.push(
    scenario('ideal', 'ideal', idealTitle),
    scenario('alt', 'alternate', altTitle),
  );
  data.activities.push(
    activity('fly', `${DAY}T09:00`, 'ideal'),
    activity('drive', `${DAY}T09:00`, 'alt'),
  );
  return data;
}

function dayOf(data: TripData, picks: [string, string][] = []): Day {
  const view = buildTripView(data, TEST_TODAY);
  const { days } = buildLiveDays(view, data, {
    scenarioPicks: new Map(picks),
    routeVariantIds: new Map(),
    mealOptionIndex: new Map(),
  });
  return days.find((d) => d.date === DAY)!;
}

const ALT_PICK: [string, string] = ['alt+ideal', 'alt'];

describe('a day’s written title', () => {
  it('shows the selected plan’s title over the date’s, and follows the plan picked', () => {
    const data = twoPlans('Gates of the Arctic', 'Grounded in Coldfoot');
    data.dayTitles.push({ _id: DAY, title: 'Coldfoot' });
    expect(dayOf(data).title).toBe('Gates of the Arctic');
    expect(dayOf(data, [ALT_PICK]).title).toBe('Grounded in Coldfoot');
  });

  it('shows the date’s title when the selected plan has none', () => {
    const data = twoPlans('Gates of the Arctic');
    data.dayTitles.push({ _id: DAY, title: 'Coldfoot' });
    expect(dayOf(data).title).toBe('Gates of the Arctic');
    expect(dayOf(data, [ALT_PICK]).title).toBe('Coldfoot');
  });

  it('shows the date’s title on a day with no plans', () => {
    const data = trip();
    data.activities.push(activity('walk', `${DAY}T09:00`, null));
    data.dayTitles.push({ _id: DAY, title: 'Dalton Highway' });
    expect(dayOf(data).title).toBe('Dalton Highway');
  });

  it('falls back to the derived title when nothing is written', () => {
    const data = trip();
    data.activities.push(activity('walk', `${DAY}T09:00`, null));
    expect(dayOf(data).title).toBe(dayOf(data).location);
  });

  it('writes a title on the date for a plain day, and removes it when blanked', () => {
    const data = trip();
    data.activities.push(activity('walk', `${DAY}T09:00`, null));
    const day = dayOf(data);
    const written = withTitle(data, titleTarget(day), '  Dalton Highway ');
    expect(written.dayTitles).toEqual([{ _id: DAY, title: 'Dalton Highway' }]);
    expect(dayOf(written).title).toBe('Dalton Highway');
    const cleared = withTitle(written, titleTarget(dayOf(written)), '   ');
    expect(cleared.dayTitles).toEqual([]);
  });

  it('edits the plan’s own title when the shown title is the plan’s, not the date’s', () => {
    const data = twoPlans('Gates of the Arctic');
    data.dayTitles.push({ _id: DAY, title: 'Coldfoot' });
    const day = dayOf(data);
    const target = titleTarget(day);
    expect(target).toEqual({ kind: 'scenario', scenarioId: 'ideal' });
    const edited = withTitle(data, target, 'Brooks Range by air');
    expect(edited.scenarios.find((s) => s._id === 'ideal')?.title).toBe('Brooks Range by air');
    expect(edited.dayTitles).toEqual(data.dayTitles);
    expect(dayOf(edited).title).toBe('Brooks Range by air');
  });

  it('edits the date’s title when the selected plan has none', () => {
    const data = twoPlans('Gates of the Arctic');
    const target = titleTarget(dayOf(data, [ALT_PICK]));
    expect(target).toEqual({ kind: 'date', date: DAY });
    const edited = withTitle(data, target, 'Coldfoot');
    expect(dayOf(edited, [ALT_PICK]).title).toBe('Coldfoot');
    expect(dayOf(edited).title).toBe('Gates of the Arctic');
  });

  it('removes a plan’s title when blanked, leaving the plan otherwise unchanged', () => {
    const data = twoPlans('Gates of the Arctic');
    const edited = withTitle(data, { kind: 'scenario', scenarioId: 'ideal' }, '');
    const plan = edited.scenarios.find((s) => s._id === 'ideal')!;
    expect('title' in plan).toBe(false);
    expect(plan).toMatchObject({ _id: 'ideal', tone: 'ideal', label: 'ideal' });
  });

  it('replaces a date’s existing title rather than adding a second', () => {
    const data = trip();
    data.dayTitles.push({ _id: DAY, title: 'Old' }, { _id: '2027-07-01', title: 'Other' });
    const edited = withTitle(data, { kind: 'date', date: DAY }, 'New');
    expect(edited.dayTitles.filter((t) => t._id === DAY)).toEqual([{ _id: DAY, title: 'New' }]);
    expect(edited.dayTitles).toContainEqual({ _id: '2027-07-01', title: 'Other' });
  });

  it('shows an edited title when live days are rebuilt from the previous cache', () => {
    const selections = {
      scenarioPicks: new Map<string, string>(),
      routeVariantIds: new Map<string, string>(),
      mealOptionIndex: new Map<string, number>(),
    };
    const titleOf = (data: TripData, previous?: ReturnType<typeof buildLiveDays>['cache']) => {
      const live = buildLiveDays(buildTripView(data, TEST_TODAY), data, selections, previous);
      return { title: live.days.find((d) => d.date === DAY)!.title, cache: live.cache };
    };
    const data = twoPlans('Gates of the Arctic');
    const first = titleOf(data);
    expect(first.title).toBe('Gates of the Arctic');
    const planEdited = withTitle(data, { kind: 'scenario', scenarioId: 'ideal' }, 'Brooks Range');
    const second = titleOf(planEdited, first.cache);
    expect(second.title).toBe('Brooks Range');
    const dateTitled = withTitle(planEdited, { kind: 'scenario', scenarioId: 'ideal' }, '');
    const third = titleOf(
      withTitle(dateTitled, { kind: 'date', date: DAY }, 'Coldfoot'),
      second.cache,
    );
    expect(third.title).toBe('Coldfoot');
  });

  it('reads date titles by date', () => {
    const data = trip();
    data.dayTitles.push({ _id: DAY, title: 'Dalton Highway' });
    const day = { date: DAY, scenarioTracks: [] };
    expect(writtenTitle(day, dateTitlesOf(data))).toBe('Dalton Highway');
    expect(writtenTitle({ date: '2027-07-01', scenarioTracks: [] }, dateTitlesOf(data))).toBeNull();
  });
});

describe('a day’s header weather place', () => {
  it('is the day’s own place, wherever its activities are', () => {
    const data = trip();
    data.stays.push({
      _id: 's1',
      legId: 'leg_t',
      scenarioId: null,
      checkInAt: '2027-06-29T15:00',
      checkOutAt: '2027-07-01T11:00',
      lodging: { place: { id: 'p_lodge', label: 'Lodge' } },
      bookingId: null,
      images: [],
    });
    data.activities.push({
      ...activity('hike', '2027-06-30T09:00', null),
      place: { id: 'p_trailhead', label: 'Trailhead' },
    });
    expect(dayOf(data).weatherPlaceId).toBe('p_lodge');
  });
});
