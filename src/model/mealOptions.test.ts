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
  const carriers = [{ packages: [pkg('tour-lunch')], startsAt: '2027-07-01T08:00' }];

  it('reads as covered whenever the holder exists, with no stay to wait for', () => {
    const options = [packageMeal('tour-lunch')];
    expect(activeMealOptionsOn(options, [], carriers, '2027-07-01', '2027-07-01T12:00')).toEqual(
      options,
    );
  });

  it('stays hidden when no stay or carrier holds the package', () => {
    expect(
      activeMealOptionsOn([packageMeal('gone')], [], carriers, '2027-07-01', '2027-07-01T12:00'),
    ).toEqual([]);
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

describe('packageCarriersOn', () => {
  const transit = {
    departsAt: '2027-07-10T20:00',
    arrivesAt: '2027-07-12T08:00',
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
