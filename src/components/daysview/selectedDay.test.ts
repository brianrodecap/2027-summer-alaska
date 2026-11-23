import { describe, expect, it } from 'vitest';

import { selectedDayDate } from './selectedDay';

describe('the day the single-day panel shows', () => {
  const dates = ['2027-06-29', '2027-06-30', '2027-07-01'];

  it('is the URL date when a day is shown for it', () => {
    expect(selectedDayDate(dates, '2027-06-30')).toBe('2027-06-30');
  });

  it('is the first day with no date in the URL', () => {
    expect(selectedDayDate(dates, undefined)).toBe('2027-06-29');
  });

  it('is the first day when the filters hide the URL date', () => {
    expect(selectedDayDate(dates, '2027-08-01')).toBe('2027-06-29');
  });

  it('is nothing when no day is left', () => {
    expect(selectedDayDate([], '2027-06-30')).toBeNull();
  });
});
