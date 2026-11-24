import { describe, expect, it } from 'vitest';

import { planSummary, type PlanSummarySources } from './planSummary';

const members = (activityIds: string[], transitIds: string[] = [], stayIds: string[] = []) => ({
  activityIds,
  transitIds,
  stayIds,
});

const place = (timeZone: string | null) => ({ label: 'Somewhere', timeZone });
const activity = (startAt: string | null, scenarioId = 'plan', zone: string | null = null) => ({
  scenarioId,
  startAt,
  place: place(zone),
  clockZone: undefined,
});

describe('the summary line of a plan', () => {
  const sources = {
    activities: new Map([
      ['late', activity('2027-06-30T13:00')],
      ['early', activity('2027-06-30T09:30')],
      ['loose', activity(null)],
      ['inner', activity('2027-06-30T07:00', 'nested')],
      ['east', activity('2027-06-30T12:00', 'plan', 'America/New_York')],
      ['west', activity('2027-06-30T10:00', 'plan', 'America/Los_Angeles')],
    ]),
    transits: new Map([
      ['drive', { scenarioId: 'plan', departsAt: '2027-06-30T08:15', from: place(null) }],
    ]),
    stays: new Map([['night', { scenarioId: 'plan' }]]),
  } as unknown as PlanSummarySources;
  const summary = (...args: Parameters<typeof members>) =>
    planSummary('plan', members(...args), sources);

  it('counts what the plan holds and names the earliest start', () => {
    expect(summary(['late', 'early'])).toBe('2 items · from 9:30am');
  });

  it('counts transits and starts from one that leaves first', () => {
    expect(summary(['late'], ['drive'])).toBe('2 items · from 8:15am');
  });

  it('leaves out what a plan nested inside it holds', () => {
    expect(summary(['early', 'inner'])).toBe('1 item · from 9:30am');
  });

  it('names no start when any item has no time, since it could come first', () => {
    expect(summary(['late', 'loose'])).toBe('2 items');
  });

  it('names no start when nothing has a time', () => {
    expect(summary(['loose'])).toBe('1 item');
    expect(summary([])).toBe('0 items');
  });

  it('starts from the earliest moment when items are on different clocks', () => {
    // 12:00 in New York is 9:00 in Los Angeles, before 10:00 there.
    expect(summary(['west', 'east'])).toBe('2 items · from 12:00pm');
  });

  it('counts a stay as an item with no time', () => {
    expect(summary([], [], ['night'])).toBe('1 item');
    expect(summary(['early'], [], ['night'])).toBe('2 items');
  });
});
