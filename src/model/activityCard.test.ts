import { describe, expect, it } from 'vitest';

import { activityCardAdds, type ActivityCardInput, activityCardLines } from './activityCard';
import type { EnrichedActivity, EnrichedMealOption, Note } from './types';

const activity = (over: object = {}) =>
  ({
    _id: 'a1',
    text: 'Packed lunch',
    place: null,
    booking: null,
    packages: null,
    travelers: null,
    includedIn: null,
    ...over,
  }) as unknown as EnrichedActivity;
const option = (over: object = {}) =>
  ({
    _id: 'o1',
    diningFormat: 'sit-down',
    place: null,
    includedIn: null,
    booking: null,
    travelers: null,
    ...over,
  }) as unknown as EnrichedMealOption;
const names = new Map([
  ['a', 'Ann Lee'],
  ['b', 'Bo Lee'],
]);
const note = (kind: Note['kind']) => ({ _id: kind, kind, text: kind }) as unknown as Note;
const adds = (over: Partial<ActivityCardInput> & { notes?: Note[] } = {}) =>
  activityCardAdds({
    data: null,
    activity: activity(),
    title: 'Packed lunch',
    notes: [],
    names,
    ...over,
  });

describe('whether an activity card opens', () => {
  it('stays shut with nothing to add, a warning it already shows included', () => {
    expect(adds()).toBe(false);
    expect(adds({ notes: [note('warning')] })).toBe(false);
    // a place known by name alone, which is the title
    const bare = { id: null, label: 'Breakfast at the cabin' };
    expect(adds({ option: option({ place: bare }), title: bare.label, formatShown: true })).toBe(
      false,
    );
  });

  it('opens to say a booking is on another clock than its place', () => {
    // a place known by name alone, so the clock note is all there is to add
    const there = { id: null, label: 'Packed lunch', timeZone: 'America/Phoenix' };
    const on = (clockZone: string | null) =>
      adds({ activity: activity({ startAt: '2027-07-01T12:00', place: there, clockZone }) });
    expect(on('America/Denver')).toBe(true);
    expect(on(null)).toBe(false);
  });

  it('opens for each thing it can add', () => {
    expect(adds({ notes: [note('info')] })).toBe(true);
    expect(adds({ notes: [note('footnote')] })).toBe(true);
    expect(adds({ activity: activity({ booking: { _id: 'b' } }) })).toBe(true);
    expect(adds({ activity: activity({ packages: [{ _id: 'p' }] }) })).toBe(true);
    expect(adds({ activity: activity({ travelers: ['Ann Lee'] }) })).toBe(true);
    expect(adds({ activity: activity({ place: { id: 'g1', label: 'Packed lunch' } }) })).toBe(true);
    expect(adds({ activity: activity({ place: { id: null, label: 'Lodge' } }) })).toBe(true);
    // the kind of meal, where no chips say it
    const cabin = option({ place: { id: null, label: 'Cabin' } });
    expect(adds({ option: cabin, title: 'Cabin' })).toBe(true);
  });
});

describe("an activity card's added lines", () => {
  const lines = (over: Partial<ActivityCardInput>) =>
    activityCardLines({ data: null, activity: activity(), title: 'Packed lunch', ...over });

  it('names the place only when the title is something else', () => {
    const place = (label: string) => activity({ place: { id: null, label } });
    expect(lines({ activity: place('Lodge') }).namedPlace).toBe('Lodge');
    expect(lines({ activity: place('Packed lunch') }).namedPlace).toBeNull();
  });

  it('leaves the kind of meal to the candidate chips when they show', () => {
    const picked = option({ place: { id: null, label: 'Diner' } });
    expect(lines({ option: picked, title: 'Diner' }).mealLine).toBe('Sit-down');
    expect(lines({ option: picked, title: 'Diner', formatShown: true }).mealLine).toBeNull();
  });

  it('never repeats the title', () => {
    const data = {
      stays: [{ _id: 's', lodging: { place: { label: 'Westmark' } } }],
      transits: [],
      activities: [],
    } as unknown as ActivityCardInput['data'];
    const included = option({ includedIn: { entity: 'stay', id: 's' } });
    expect(lines({ data, option: included, title: 'Included' }).mealLine).toBe(
      'Included with Westmark',
    );
    expect(lines({ data, option: included, title: 'Included with Westmark' }).mealLine).toBeNull();
  });
});
