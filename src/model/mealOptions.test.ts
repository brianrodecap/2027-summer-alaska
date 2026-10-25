import { describe, expect, it } from 'vitest';

import { includedInOptions } from './editForms';
import { activeMealOptionsOn, packageCarriersOn, selectedMealOptions } from './mealOptions';
import type { Activity, MealOption, Package, Stay, Transit } from './types';

const pkg = (_id: string): Package => ({ _id, name: `Package ${_id}` }) as Package;
const packageMeal = (id: string) =>
  ({ diningFormat: 'package', includedIn: { entity: 'package', id } }) as Pick<
    MealOption,
    'diningFormat' | 'includedIn'
  >;

describe('package meals held by transits and activities', () => {
  const carriers = [
    { packages: [pkg('tour-lunch')], startsAt: { at: '2027-07-01T08:00', zone: null } },
  ];
  const noon = { at: '2027-07-01T12:00', zone: null };

  it('reads as covered whenever the holder exists, with no stay to wait for', () => {
    const options = [packageMeal('tour-lunch')];
    expect(activeMealOptionsOn(options, [], carriers, '2027-07-01', noon)).toEqual(options);
  });

  it('stays hidden when no stay or carrier holds the package', () => {
    expect(activeMealOptionsOn([packageMeal('gone')], [], carriers, '2027-07-01', noon)).toEqual(
      [],
    );
  });

  it('is offered by the candidate list alongside stay packages, in date order', () => {
    const stay = {
      _id: 's1',
      checkInAt: '2027-07-02T15:00',
      packages: [pkg('stay-pkg')],
    } as unknown as Stay;
    const transit = {
      _id: 't1',
      departsAt: '2027-07-01T08:00',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      packages: [pkg('tour-lunch')],
    } as unknown as Transit;
    const activity = {
      _id: 'a1',
      mealType: null,
      startAt: '2027-07-03T09:00',
      packages: [pkg('act-pkg')],
    } as unknown as Activity;
    const values = includedInOptions('package', [stay], [activity], [transit]).map((o) => o.value);
    expect(values).toEqual(['package:tour-lunch', 'package:stay-pkg', 'package:act-pkg']);
  });

  it('orders candidates by real time, each on its own clock', () => {
    // 09:30 in Denver (15:30 UTC) is before 09:00 in Page (16:00 UTC).
    const transit = {
      _id: 't1',
      departsAt: '2027-07-01T09:30',
      from: { id: null, label: 'Denver', timeZone: 'America/Denver' },
      to: { id: null, label: 'B' },
      packages: [pkg('den')],
    } as unknown as Transit;
    const activity = {
      _id: 'a1',
      mealType: null,
      startAt: '2027-07-01T09:00',
      place: { id: null, label: 'Page', timeZone: 'America/Phoenix' },
      packages: [pkg('page')],
    } as unknown as Activity;
    const values = includedInOptions('package', [], [activity], [transit]).map((o) => o.value);
    expect(values).toEqual(['package:den', 'package:page']);
  });

  it('orders a date-only activity at its time label’s slot, as the day list does', () => {
    const transit = {
      _id: 't1',
      departsAt: '2027-07-01T09:30',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      packages: [pkg('drive')],
    } as unknown as Transit;
    // 'Afternoon' sits at 13:00, after the 09:30 departure.
    const activity = {
      _id: 'a1',
      mealType: null,
      startAt: null,
      date: '2027-07-01',
      timeLabel: 'Afternoon',
      packages: [pkg('tour')],
    } as unknown as Activity;
    const values = includedInOptions('package', [], [activity], [transit]).map((o) => o.value);
    expect(values).toEqual(['package:drive', 'package:tour']);
  });

  it('keeps each date’s candidates together when clocks put them out of real-time order', () => {
    // 01:00 on Jul 2 in New York (05:00 UTC) is before 23:00 on Jul 1 in
    // Anchorage (07:00 UTC), but Jul 1's group still comes first.
    const early = {
      _id: 'a1',
      mealType: null,
      startAt: '2027-07-02T01:00',
      place: { id: null, label: 'NYC', timeZone: 'America/New_York' },
      packages: [pkg('jul2-early')],
    } as unknown as Activity;
    const late = { ...early, _id: 'a2', startAt: '2027-07-02T12:00', packages: [pkg('jul2-late')] };
    const transit = {
      _id: 't1',
      departsAt: '2027-07-01T23:00',
      from: { id: null, label: 'ANC', timeZone: 'America/Anchorage' },
      to: { id: null, label: 'B' },
      packages: [pkg('jul1')],
    } as unknown as Transit;
    const options = includedInOptions('package', [], [late, early], [transit]);
    expect(options.map((o) => o.value)).toEqual([
      'package:jul1',
      'package:jul2-early',
      'package:jul2-late',
    ]);
  });

  it('counts only the holders on the meal’s own date', () => {
    const meal = {
      _id: 'lunch',
      startAt: '2027-07-01T12:00',
      date: null,
      options: [{ ...packageMeal('tour-lunch'), place: { id: null, label: 'Lodge' } }],
    } as unknown as Activity;
    const carriersOn = (date: string) => (date === '2027-07-01' ? carriers : []);
    const on = (day: string) =>
      selectedMealOptions(
        [{ ...meal, startAt: `${day}T12:00` } as Activity],
        () => [],
        carriersOn,
        new Map(),
      ).has('lunch');
    expect(on('2027-07-01')).toBe(true);
    expect(on('2027-07-02')).toBe(false);
  });
});

describe('included meals on the check-in day', () => {
  // Check-in at 15:00 on Denver time (21:00 UTC) at a lodge on Phoenix time.
  const stay = {
    _id: 's1',
    checkInAt: '2027-06-01T15:00',
    checkOutAt: '2027-06-03T11:00',
    clockZone: 'America/Denver',
    lodging: { place: { id: null, label: 'Lodge', timeZone: 'America/Phoenix' } },
  } as unknown as Stay;
  const included = {
    diningFormat: 'included',
    includedIn: { entity: 'stay', id: 's1' },
  } as Pick<MealOption, 'diningFormat' | 'includedIn'>;
  const at = (wall: string) => ({ at: `2027-06-01T${wall}`, zone: 'America/Phoenix' });

  it('covers a meal after check-in in real time, each on its own clock', () => {
    // 14:30 in Phoenix is 21:30 UTC, after check-in though it reads earlier.
    expect(activeMealOptionsOn([included], [stay], [], '2027-06-01', at('14:30'))).toHaveLength(1);
  });

  it('covers a package meal once its carrier has started in real time', () => {
    // The drive leaves Denver at 09:30 (15:30 UTC); 09:00 in Phoenix is 16:00 UTC.
    const carriers = packageCarriersOn(
      [
        {
          departsAt: '2027-06-01T09:30',
          arrivesAt: '2027-06-01T12:00',
          from: { id: null, label: 'Denver', timeZone: 'America/Denver' },
          packages: [pkg('drive-lunch')],
        },
      ],
      [],
      '2027-06-01',
    );
    expect(
      activeMealOptionsOn([packageMeal('drive-lunch')], [], carriers, '2027-06-01', at('09:00')),
    ).toHaveLength(1);
  });

  it('doesn’t cover one before check-in', () => {
    // 13:30 in Phoenix is 20:30 UTC.
    expect(activeMealOptionsOn([included], [stay], [], '2027-06-01', at('13:30'))).toEqual([]);
  });
});

describe('packageCarriersOn', () => {
  const transit = {
    departsAt: '2027-07-10T20:00',
    arrivesAt: '2027-07-12T08:00',
    from: { id: null, label: 'Ferry terminal' },
    packages: [pkg('ferry-meals')],
  };

  it('keeps a multi-day transit’s package on every day it is under way', () => {
    for (const date of ['2027-07-10', '2027-07-11', '2027-07-12']) {
      expect(packageCarriersOn([transit], [], date)).toHaveLength(1);
    }
    expect(packageCarriersOn([transit], [], '2027-07-09')).toEqual([]);
    expect(packageCarriersOn([transit], [], '2027-07-13')).toEqual([]);
  });

  it('counts a routed transit (no authored arrival) on its departure day only', () => {
    const routed = { ...transit, arrivesAt: null };
    expect(packageCarriersOn([routed], [], '2027-07-10')).toHaveLength(1);
    expect(packageCarriersOn([routed], [], '2027-07-11')).toEqual([]);
  });
});
