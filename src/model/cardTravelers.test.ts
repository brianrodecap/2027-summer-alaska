import { describe, expect, it } from 'vitest';

import { cardTravelers } from './cardTravelers';

const party = ['Ann Lee', 'Bo Lee', 'Cy Lee'];
const names = new Map([
  ['a', 'Ann Lee'],
  ['b', 'Bo Lee'],
  ['c', 'Cy Lee'],
]);
const list = (going: string[] | null, seats?: Parameters<typeof cardTravelers>[0]['seats']) =>
  cardTravelers({ going, seats, names });

describe('the travelers an expanded card lists', () => {
  it('lists nobody for the whole party, however it is written', () => {
    expect(list(null)).toBeNull();
    expect(list([])).toBeNull();
    expect(list([...party])).toBeNull();
  });

  it('lists a subset by first name', () => {
    expect(list(['Ann Lee', 'Cy Lee'])).toEqual([
      { name: 'Ann', detail: null },
      { name: 'Cy', detail: null },
    ]);
  });

  it('lists the whole party when they have seats, each with theirs', () => {
    expect(
      list(null, [
        { travelerId: 'a', seat: '22A', cabin: 'Main Cabin', fareClass: 'N' },
        { travelerId: 'b', seat: '22B' },
      ]),
    ).toEqual([
      { name: 'Ann', detail: '22A · Main Cabin (N)' },
      { name: 'Bo', detail: '22B' },
      { name: 'Cy', detail: null },
    ]);
  });

  it('keeps a seat for someone the list of those going leaves out, and an unknown id as written', () => {
    expect(
      list(['Ann Lee'], [{ travelerId: 'zed', seat: '1C', fareClass: 'Y' }])!.map((t) => [
        t.name,
        t.detail,
      ]),
    ).toEqual([
      ['Ann', null],
      ['zed', '1C · Y'],
    ]);
  });
});
