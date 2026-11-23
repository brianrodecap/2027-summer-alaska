import { describe, expect, it } from 'vitest';

import type { DayKind } from './dayKind';
import { kindStamp, planCount, posterCaption } from './dayPoster';

describe('the caption of a day poster', () => {
  it('names the day of the month, the weekday, the month and the day of the trip', () => {
    expect(posterCaption('2027-06-29', '2027-06-26')).toEqual({
      number: '29',
      dayLine: 'Tue · June · Day 4',
    });
  });

  it('counts the first day of the trip as Day 1', () => {
    expect(posterCaption('2027-06-26', '2027-06-26').dayLine).toBe('Sat · June · Day 1');
  });

  it('drops the leading zero of the day of the month', () => {
    expect(posterCaption('2027-07-05', '2027-06-26').number).toBe('5');
  });

  it('counts across a month end', () => {
    expect(posterCaption('2027-07-01', '2027-06-26').dayLine).toBe('Thu · July · Day 6');
  });

  it('has no day number before the trip starts, or with no start', () => {
    expect(posterCaption('2027-06-20', '2027-06-26').dayLine).toBe('Sun · June');
    expect(posterCaption('2027-06-20', null).dayLine).toBe('Sun · June');
  });
});

describe('the stamp of a kind of day', () => {
  it('names each kind of day but staying put', () => {
    const stamps: [DayKind, string | null][] = [
      ['drive', 'Drive day'],
      ['flight', 'Flight day'],
      ['port', 'In port'],
      ['sea', 'At sea'],
      ['stay', null],
    ];
    for (const [kind, stamp] of stamps) expect(kindStamp(kind, 0)).toBe(stamp);
  });

  it('counts the plans of a day with plans', () => {
    expect(kindStamp('scenario', 2)).toBe('Two plans');
    expect(kindStamp('scenario', 3)).toBe('Three plans');
    expect(kindStamp('scenario', 9)).toBe('9 plans');
    expect(kindStamp('scenario', 1)).toBe('One plan');
  });

  it('counts the plans of the largest group, not every tab on the day', () => {
    const tab = (groupKey: string) => ({ groupKey });
    expect(planCount([tab('a'), tab('a'), tab('b'), tab('b')])).toBe(2);
    expect(planCount([tab('a'), tab('a'), tab('a'), tab('b')])).toBe(3);
    expect(planCount([tab('a')])).toBe(1);
    expect(planCount([])).toBe(0);
  });
});
