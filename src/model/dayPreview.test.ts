import { describe, expect, it } from 'vitest';

import { dayClock, dayPreviewSteps } from './dayPreview';
import { previewState, previewTotal } from './routePlanner';

const MIN = 60_000;
const at = (minutes: number, stopMinutes = 0) => ({ order: minutes * MIN, stopMinutes });

describe('the steps of a day preview', () => {
  it('stays at a place until it is time to leave for the next', () => {
    // 0:00 start, 1:00 second stop (30 min away), 3:00 third (60 min away)
    const steps = dayPreviewSteps([at(0), at(60), at(180)], [0, 30, 60]);
    expect(steps).toEqual([
      { drive: 0, stop: 30, place: 0 },
      { drive: 30, stop: 60, place: 1 },
      { drive: 60, stop: 0, place: 2 },
    ]);
    expect(previewTotal(steps)).toBe(180);
  });

  it('keeps a stop at least as long as the visit takes', () => {
    const steps = dayPreviewSteps([at(0, 90), at(60)], [0, 30]);
    expect(steps[0].stop).toBe(90);
  });

  it('leaves a place reached late at once', () => {
    // the second stop is due at 1:00 but the drive alone takes until 2:00
    const steps = dayPreviewSteps([at(0), at(60), at(90)], [0, 120, 10]);
    expect(steps[1]).toEqual({ drive: 120, stop: 0, place: 1 });
  });

  it('hops where nothing is driven', () => {
    const steps = dayPreviewSteps([at(0), at(120)], [0, 0]);
    expect(steps[0]).toEqual({ drive: 0, stop: 120, place: 0 });
    expect(previewState(steps, 60).stop).toBe(0);
    expect(previewState(steps, 130)).toEqual({ leg: 1, fraction: 1, stop: null });
  });

  it('has nothing to play for no places', () => {
    expect(dayPreviewSteps([], [])).toEqual([]);
  });
});

describe('the clock of a day preview', () => {
  it('reads an instant on the zone given', () => {
    const noonUtc = Date.UTC(2027, 5, 30, 20, 0);
    expect(dayClock(noonUtc, 'America/Anchorage')).toBe('12:00 pm');
    expect(dayClock(noonUtc, null)).toBe('8:00 pm');
  });
});
