import { describe, expect, it } from 'vitest';

import { isReverseDrive, reverseRoute, reverseVariant, routeForDrive } from './routeReverse';
import type { Route, RoutePlaceEntry, RouteVariant } from './types';

const stop = (id: string, minutes: number, extra: Partial<RoutePlaceEntry> = {}) =>
  ({
    kind: 'waypoint',
    place: { id, label: id },
    travel: { minutes },
    ...extra,
  }) as RoutePlaceEntry;
const route = (from: string | null, to: string | null, variants: RouteVariant[] = []) =>
  ({
    _id: `${from}-${to}`,
    from: { id: from, label: '' },
    to: { id: to, label: '' },
    variants,
    images: [],
  }) as Route;
const at = (from: string | null, to: string | null) => ({ from: { id: from }, to: { id: to } });

describe('reverseVariant', () => {
  const forward: RouteVariant = {
    id: 'scenic',
    tone: 'scenic',
    label: 'Scenic',
    places: [stop('a', 10, { durationMinutes: 20 }), stop('b', 30, { kind: 'via' }), stop('c', 50)],
    finalTravel: { minutes: 70 },
  };
  it('reverses the places and moves each drive time to the leg it now belongs to', () => {
    const back = reverseVariant(forward);
    expect(back.places.map((p) => p.place!.id)).toEqual(['c', 'b', 'a']);
    // leg to c was the final leg; b-to-c's time goes to c-to-b; a-to-b's to b-to-a
    expect(back.places.map((p) => p.travel.minutes)).toEqual([70, 50, 30]);
    // and the leg from the origin to a is now the last one
    expect(back.finalTravel.minutes).toBe(10);
  });
  it('keeps each place its own kind, stop time and the variant its own label', () => {
    const back = reverseVariant(forward);
    expect(back.places[1].kind).toBe('via');
    expect(back.places[2].durationMinutes).toBe(20);
    expect(back.label).toBe('Scenic');
  });
  it('is its own inverse', () => {
    expect(reverseVariant(reverseVariant(forward))).toEqual(forward);
  });
  it('leaves a variant with no places as it is', () => {
    const bare: RouteVariant = {
      id: 'direct',
      tone: 'direct',
      label: 'D',
      places: [],
      finalTravel: { minutes: 5 },
    };
    expect(reverseVariant(bare)).toBe(bare);
  });
});

describe('reverseRoute', () => {
  it('swaps the ends and reverses every variant', () => {
    const r = route('x', 'y', [
      {
        id: 'direct',
        tone: 'direct',
        label: 'D',
        places: [stop('a', 10)],
        finalTravel: { minutes: 20 },
      },
    ]);
    const back = reverseRoute(r);
    expect([back.from.id, back.to.id]).toEqual(['y', 'x']);
    expect(back.variants[0].finalTravel.minutes).toBe(10);
  });
});

describe('isReverseDrive', () => {
  it('is true only for a drive that starts at the route end and ends at its start', () => {
    expect(isReverseDrive(route('x', 'y'), at('y', 'x'))).toBe(true);
    expect(isReverseDrive(route('x', 'y'), at('x', 'y'))).toBe(false);
    expect(isReverseDrive(route('x', 'y'), at('y', 'z'))).toBe(false);
  });
  it('is never true for a round trip or an unresolved place', () => {
    expect(isReverseDrive(route('x', 'x'), at('x', 'x'))).toBe(false);
    expect(isReverseDrive(route(null, null), at(null, null))).toBe(false);
    // an unresolved place never matches another unresolved one
    expect(isReverseDrive(route(null, 'y'), at('y', null))).toBe(false);
    expect(isReverseDrive(route('x', null), at(null, 'x'))).toBe(false);
  });
});

describe('routeForDrive', () => {
  const xy = route('x', 'y');
  const yx = route('y', 'x');
  it('prefers a route running the same way, and falls back to the reverse', () => {
    expect(routeForDrive([yx, xy], at('x', 'y'))).toBe(xy);
    expect(routeForDrive([yx], at('x', 'y'))).toBe(yx);
  });
  it('finds nothing for a pair no route connects or one with unresolved places', () => {
    expect(routeForDrive([xy], at('x', 'z'))).toBeNull();
    expect(routeForDrive([route(null, null)], at(null, null))).toBeNull();
    expect(routeForDrive([route(null, 'y')], at(null, 'y'))).toBeNull();
    expect(routeForDrive([route('x', null)], at('x', null))).toBeNull();
  });
  it('picks the lowest id when several routes connect the same pair, whatever the order', () => {
    const a = { ...xy, _id: 'a' };
    const b = { ...xy, _id: 'b' };
    expect(routeForDrive([b, a], at('x', 'y'))).toBe(a);
    expect(routeForDrive([a, b], at('x', 'y'))).toBe(a);
  });
});
