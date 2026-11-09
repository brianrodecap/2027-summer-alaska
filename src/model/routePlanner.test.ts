import { describe, expect, it } from 'vitest';

import {
  arrivalMinutes,
  boundsOf,
  boundsOverlap,
  doublingBack,
  draftVariantId,
  exampleClock,
  fromTimeInput,
  hasScenic,
  insertIndexFor,
  matchesFilters,
  needsPlaces,
  offsetPath,
  openingVariantIndex,
  optimizeOrder,
  pathMiles,
  pointOnPath,
  previewState,
  previewSteps,
  previewTotal,
  routeDoublesBack,
  type RouteFilter,
  routeMilesRange,
  routePoints,
  routeTimeRange,
  straightMiles,
  toTimeInput,
  variantColor,
  variantColorIndex,
  variantPoints,
  variantSplit,
  variantSummary,
  withStopKind,
  withStopMinutes,
} from './routePlanner';
import type { Route, RoutePlaceEntry, RouteVariant } from './types';

const stop = (minutes: number, miles: number, extra: Partial<RoutePlaceEntry> = {}) =>
  ({ kind: 'waypoint', travel: { minutes, miles }, ...extra }) as RoutePlaceEntry;

describe('variantSummary', () => {
  it('adds each leg, each waypoint stop, and the final leg', () => {
    const summary = variantSummary({
      places: [stop(60, 50, { durationMinutes: 20 }), stop(30, 20.4)],
      finalTravel: { minutes: 10, miles: 5 },
    });
    // 60 + 20 + 30 + the default stop time for the second + 10
    expect(summary.minutes).toBe(60 + 20 + 30 + 15 + 10);
    expect(summary.miles).toBe(75);
    expect(summary.stops).toBe(2);
  });

  it('spends no stop time at a via', () => {
    const summary = variantSummary({
      places: [stop(30, 10, { kind: 'via', durationMinutes: 99 })],
      finalTravel: { minutes: 0 },
    });
    expect(summary.minutes).toBe(30);
    expect(summary.stops).toBe(0);
  });
});

describe('variantColorIndex', () => {
  const variants = [{ tone: 'scenic' }, { tone: 'direct' }, { tone: 'scenic' }, { tone: 'scenic' }];
  it('gives the direct variant 0 wherever it sits, and the scenic ones 1, 2, 1', () => {
    expect(variants.map((_, i) => variantColorIndex(variants, i))).toEqual([1, 0, 2, 1]);
  });
});

describe('variantColor', () => {
  it("picks the theme color at the variant's color index", () => {
    const variants = [{ tone: 'scenic' }, { tone: 'direct' }];
    expect(variants.map((_, i) => variantColor(['blue', 'gold', 'teal'], variants, i))).toEqual([
      'gold',
      'blue',
    ]);
  });
});

describe('bounds', () => {
  const box = boundsOf([
    { lat: 60, lng: -150 },
    { lat: 62, lng: -148 },
  ]);
  it('wraps the points', () => {
    expect(box).toEqual({ north: 62, south: 60, east: -148, west: -150 });
    expect(boundsOf([])).toBeNull();
  });
  it('overlaps when boxes touch or cross, not when apart', () => {
    const view = (south: number, north: number, west: number, east: number) => ({
      south,
      north,
      west,
      east,
    });
    expect(boundsOverlap(box!, view(61, 63, -149, -147))).toBe(true);
    expect(boundsOverlap(box!, view(62, 63, -148, -147))).toBe(true);
    expect(boundsOverlap(box!, view(63, 64, -149, -147))).toBe(false);
    expect(boundsOverlap(box!, view(60, 62, -146, -145))).toBe(false);
  });
});

describe('offsetPath', () => {
  const east = [
    { lat: 61, lng: -150 },
    { lat: 61, lng: -149 },
    { lat: 61, lng: -148 },
  ];
  it('shifts to the right of travel: a path heading east moves south', () => {
    const moved = offsetPath(east, 8, 10);
    for (const p of moved) expect(p.lat).toBeLessThan(61);
    expect(moved.map((p) => p.lng)).toEqual(east.map((p) => expect.closeTo(p.lng, 6)));
  });
  it('shifts the other way for a negative offset or the reversed path', () => {
    for (const p of offsetPath(east, -8, 10)) expect(p.lat).toBeGreaterThan(61);
    for (const p of offsetPath([...east].reverse(), 8, 10)) expect(p.lat).toBeGreaterThan(61);
  });
  it('is the same few pixels at any zoom, so the world distance halves per zoom step', () => {
    const gap = (zoom: number) => 61 - offsetPath(east, 8, zoom)[1].lat;
    expect(gap(10) / gap(11)).toBeCloseTo(2, 3);
  });
  it('keeps the same sideways distance through a repeated point and an exact U-turn', () => {
    const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const at = (lng: number) => ({ lat: 61, lng });
    const sideways = (path: ReturnType<typeof at>[]) =>
      offsetPath(path, 8, 10).map((p) => Math.abs(mercatorY(p.lat) - mercatorY(61)));
    for (const path of [
      [at(-150), at(-149), at(-149), at(-148)], // a joint repeated
      [at(-150), at(-149), at(-150.5)], // straight back the way it came
    ]) {
      const gaps = sideways(path);
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 9);
      expect(gaps[0]).toBeGreaterThan(0);
    }
  });
  it('returns the path untouched for no offset or a single point', () => {
    expect(offsetPath(east, 0, 10)).toBe(east);
    const one = [east[0]];
    expect(offsetPath(one, 8, 10)).toBe(one);
  });
});

describe('routePoints', () => {
  const route = {
    from: { id: 'a', label: 'A' },
    to: { id: 'b', label: 'B' },
    variants: [
      { places: [stop(1, 1, { place: { id: 'c', label: 'C' } }), stop(1, 1)] },
      { places: [stop(1, 1, { place: { id: 'missing', label: 'M' } })] },
    ],
  } as unknown as Route;
  it('lists the resolved points of the ends and every variant, skipping the rest', () => {
    const coords = new Map([
      ['a', { lat: 1, lng: 1 }],
      ['b', { lat: 2, lng: 2 }],
      ['c', { lat: 3, lng: 3 }],
    ]);
    expect(routePoints(route, coords)).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });
});

describe('doublingBack', () => {
  const at = (lng: number) => ({ lat: 61, lng });
  it('flags only the leg that moves against the way the drive is going', () => {
    expect(doublingBack([at(-150), at(-149), at(-149.5), at(-148)])).toEqual([false, true, false]);
  });
  it('flags nothing on a round trip, or when an end is unresolved', () => {
    expect(doublingBack([at(-150), at(-149), at(-150)])).toEqual([false, false]);
    expect(doublingBack([null, at(-149), at(-148)])).toEqual([false, false]);
    expect(doublingBack([at(-150), at(-151), null])).toEqual([false, false]);
  });
  it('skips a leg whose own end is unresolved', () => {
    expect(doublingBack([at(-150), null, at(-148)])).toEqual([false, false]);
  });
});

describe('variantPoints', () => {
  it('lines the ends and places up with their points, null where unresolved', () => {
    const route = {
      from: { id: 'a', label: 'A' },
      to: { id: 'b', label: 'B' },
    } as unknown as Route;
    const variant = {
      places: [stop(1, 1, { place: { id: 'c', label: 'C' } }), stop(1, 1)],
    } as unknown as RouteVariant;
    const coords = new Map([
      ['a', { lat: 1, lng: 1 }],
      ['c', { lat: 3, lng: 3 }],
    ]);
    expect(variantPoints(route, variant, coords)).toEqual([
      { lat: 1, lng: 1 },
      { lat: 3, lng: 3 },
      null,
      null,
    ]);
  });
});

describe('straightMiles and pathMiles', () => {
  it('measures about 69 miles to a degree of latitude, and adds up a path', () => {
    const a = { lat: 61, lng: -150 };
    const b = { lat: 62, lng: -150 };
    expect(straightMiles(a, b)).toBeCloseTo(69, 0);
    expect(pathMiles([a, b, a])).toBeCloseTo(2 * straightMiles(a, b), 6);
    expect(pathMiles([a])).toBe(0);
  });
});

describe('optimizeOrder', () => {
  const at = (lng: number) => ({ lat: 61, lng });
  const from = at(-150);
  const to = at(-148);
  it('puts stops in the order along the way', () => {
    // asked as [-148.5, -149, -149.5]; the shortest way is the reverse
    expect(optimizeOrder(from, to, [at(-148.5), at(-149), at(-149.5)])).toEqual([2, 1, 0]);
  });
  it('keeps an order that is already shortest, and one that is shorter by under a mile', () => {
    expect(optimizeOrder(from, to, [at(-149.5), at(-149), at(-148.5)])).toEqual([0, 1, 2]);
    // reversing these two would save about two thirds of a mile: not worth a change
    expect(optimizeOrder(from, to, [at(-149), at(-149.01)])).toEqual([0, 1]);
  });
  it('leaves fewer than two stops and more than eight alone', () => {
    expect(optimizeOrder(from, to, [at(-149)])).toEqual([0]);
    const nine = Array.from({ length: 9 }, (_, i) => at(-148.1 - i * 0.1));
    expect(optimizeOrder(from, to, nine)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('withStopKind', () => {
  const waypoint = stop(10, 5, { durationMinutes: 20 });
  it('drops the stop time when a stop becomes a via', () => {
    const via = withStopKind(waypoint, 'via');
    expect(via.kind).toBe('via');
    expect('durationMinutes' in via).toBe(false);
    expect(via.travel).toEqual(waypoint.travel);
  });
  it('keeps everything else of a waypoint, and the entry itself unchanged', () => {
    expect(withStopKind(waypoint, 'waypoint')).toEqual(waypoint);
    expect(waypoint.kind).toBe('waypoint');
  });
});

describe('withStopMinutes', () => {
  const entry = stop(10, 5, { durationMinutes: 20, note: 'Fuel' });
  it('sets the number typed, and leaves the rest alone', () => {
    expect(withStopMinutes(entry, '35')).toEqual({ ...entry, durationMinutes: 35 });
    expect(withStopMinutes(entry, '0').durationMinutes).toBe(0);
  });
  it('lets a blank field fall back to the default by dropping the stored time', () => {
    const blank = withStopMinutes(entry, '  ');
    expect('durationMinutes' in blank).toBe(false);
    expect(blank.note).toBe('Fuel');
  });
});

describe('draftVariantId', () => {
  const v = (id: string, tone: string) => ({
    id,
    tone,
    label: id,
    places: [],
    finalTravel: { minutes: 1 },
  });
  const base = {
    _id: 'r',
    from: { id: 'a', label: 'A' },
    to: { id: 'b', label: 'B' },
    images: [],
    variants: [v('d', 'direct'), v('s1', 'scenic')],
  } as unknown as Route;
  const draft = (...extra: RouteVariant[]) => ({ ...base, variants: [...base.variants, ...extra] });

  it('is the variant the draft revised', () => {
    const revised = {
      ...base,
      variants: [v('d', 'direct'), { ...v('s1', 'scenic'), label: 'New' }],
    };
    expect(draftVariantId(revised, base, 'scenic', 's1')).toBe('s1');
  });
  it('is not a variant the draft left as it was', () => {
    expect(draftVariantId(draft(), base, 'scenic', 's1')).toBeNull();
    expect(draftVariantId(draft(v('s2', 'scenic')), base, 'scenic', 's1')).toBe('s2');
  });
  it('is the one new variant of the tone, not the existing one that shares it', () => {
    expect(draftVariantId(draft(v('s2', 'scenic')), base, 'scenic')).toBe('s2');
  });
  it('is the direct variant of a route with no base', () => {
    expect(draftVariantId(draft(), null, 'direct')).toBe('d');
  });
  it('is null when it would be a guess', () => {
    expect(draftVariantId(draft(v('s2', 'scenic'), v('s3', 'scenic')), base, 'scenic')).toBeNull();
    expect(draftVariantId(draft(), base, 'scenic')).toBeNull();
    expect(draftVariantId(draft(), base, 'scenic', 'gone')).toBeNull();
  });
});

describe('preview', () => {
  // 60 min to a waypoint (stopped 20), 30 to a via, 45 to the end.
  const variant = {
    places: [stop(60, 10, { durationMinutes: 20 }), { ...stop(30, 5), kind: 'via' as const }],
    finalTravel: { minutes: 45, miles: 8 },
  };
  const steps = previewSteps(variant);

  it('times each leg and its stop: a via and the end have none, a waypoint its own or the default', () => {
    expect(steps).toEqual([
      { drive: 60, stop: 20, place: 0 },
      { drive: 30, stop: 0, place: 1 },
      { drive: 45, stop: 0, place: null },
    ]);
    expect(previewSteps({ places: [stop(5, 1)], finalTravel: { minutes: 5 } })[0].stop).toBe(15);
    expect(previewTotal(steps)).toBe(155);
  });

  it('finds the leg and how far along it, or the stop being made', () => {
    expect(previewState(steps, 30)).toEqual({ leg: 0, fraction: 0.5, stop: null });
    expect(previewState(steps, 60)).toEqual({ leg: 0, fraction: 1, stop: 0 });
    expect(previewState(steps, 79)).toEqual({ leg: 0, fraction: 1, stop: 0 });
    expect(previewState(steps, 80)).toEqual({ leg: 1, fraction: 0, stop: null });
    expect(previewState(steps, 110)).toEqual({ leg: 2, fraction: 0, stop: null });
  });

  it('ends on the last leg, and starts at the first for a minute before it', () => {
    expect(previewState(steps, 155)).toEqual({ leg: 2, fraction: 1, stop: null });
    expect(previewState(steps, 999)).toEqual({ leg: 2, fraction: 1, stop: null });
    expect(previewState(steps, -5)).toEqual({ leg: 0, fraction: 0, stop: null });
  });

  it('skips a leg that takes no time', () => {
    const quick = previewSteps({ places: [stop(0, 0)], finalTravel: { minutes: 10 } });
    expect(previewState(quick, 0)).toEqual({ leg: 0, fraction: 1, stop: 0 });
  });

  it('finds a point by distance along a path', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    expect(pointOnPath(path, 0)).toEqual(path[0]);
    expect(pointOnPath(path, 1)).toEqual(path[2]);
    expect(pointOnPath(path, 2)).toEqual(path[2]);
    expect(pointOnPath(path, -1)).toEqual(path[0]);
    // a third of the way is the end of the first, shorter segment
    expect(pointOnPath(path, 1 / 3).lng).toBeCloseTo(1, 5);
    expect(pointOnPath(path, 2 / 3).lng).toBeCloseTo(2, 5);
    expect(pointOnPath([path[0], path[0]], 0.5)).toEqual(path[0]);
  });

  it('shows an example clock from 8:00 AM', () => {
    expect(exampleClock(0)).toBe('8:00 AM');
    expect(exampleClock(255)).toBe('12:15 PM');
    expect(exampleClock(5 * 60 + 5)).toBe('1:05 PM');
    expect(exampleClock(16 * 60)).toBe('12:00 AM');
  });
});

describe('route filters', () => {
  const entry = (id: string) =>
    ({ kind: 'waypoint', place: { id, label: id }, travel: { minutes: 1 } }) as RoutePlaceEntry;
  const variant = (tone: string, ids: string[]): RouteVariant => ({
    id: tone,
    tone,
    label: tone,
    places: ids.map(entry),
    finalTravel: { minutes: 1 },
  });
  const route = (variants: RouteVariant[]): Route =>
    ({
      _id: 'r',
      from: { id: 'a', label: 'A' },
      to: { id: 'd', label: 'D' },
      variants,
      images: [],
    }) as Route;
  // A to D runs east; going to C then B backtracks west.
  const coords = new Map([
    ['a', { lat: 0, lng: 0 }],
    ['b', { lat: 0, lng: 2 }],
    ['c', { lat: 0, lng: 1 }],
    ['d', { lat: 0, lng: 3 }],
  ]);
  const on = (...f: RouteFilter[]) => new Set(f);

  it('needs places when no variant has any, and a route with no variants is left alone', () => {
    expect(needsPlaces(route([variant('direct', []), variant('scenic', [])]))).toBe(true);
    expect(needsPlaces(route([variant('direct', []), variant('scenic', ['b'])]))).toBe(false);
    expect(needsPlaces(route([]))).toBe(false);
  });

  it('has scenic when any variant is not the direct one', () => {
    expect(hasScenic(route([variant('direct', [])]))).toBe(false);
    expect(hasScenic(route([variant('direct', []), variant('scenic', [])]))).toBe(true);
  });

  it('doubles back when any variant has a leg against the way the drive goes', () => {
    expect(routeDoublesBack(route([variant('direct', ['b', 'c'])]), coords)).toBe(true);
    expect(routeDoublesBack(route([variant('direct', ['c', 'b'])]), coords)).toBe(false);
    // other variants count, and a place with no coordinates yet can't be judged
    expect(
      routeDoublesBack(route([variant('direct', ['c']), variant('scenic', ['b', 'c'])]), coords),
    ).toBe(true);
    expect(routeDoublesBack(route([variant('direct', ['b', 'c'])]), new Map())).toBe(false);
  });

  it('passes a route that meets every active filter, and any route when none is active', () => {
    const both = route([variant('direct', []), variant('scenic', [])]);
    expect(matchesFilters(both, on(), coords)).toBe(true);
    expect(matchesFilters(both, on('needsPlaces', 'hasScenic'), coords)).toBe(true);
    expect(matchesFilters(both, on('needsPlaces', 'doublesBack'), coords)).toBe(false);
    const finished = route([variant('direct', ['b']), variant('scenic', ['c'])]);
    expect(matchesFilters(finished, on('needsPlaces'), coords)).toBe(false);
    expect(matchesFilters(finished, on('hasScenic'), coords)).toBe(true);
    expect(matchesFilters(route([variant('direct', ['b', 'c'])]), on('hasScenic'), coords)).toBe(
      false,
    );
  });
});

describe('insertIndexFor', () => {
  // A drive east along a line: start, two places, end.
  const line = [0, 10, 20, 30].map((lng) => ({ lat: 0, lng }));
  const at = (lng: number) => ({ lat: 0.01, lng });

  it('puts a place between the neighbours it lies between', () => {
    expect(insertIndexFor(line, at(5))).toBe(0);
    expect(insertIndexFor(line, at(15))).toBe(1);
    expect(insertIndexFor(line, at(25))).toBe(2);
  });
  it('puts a place beyond either end at that end', () => {
    expect(insertIndexFor(line, at(-20))).toBe(0);
    expect(insertIndexFor(line, at(60))).toBe(2);
  });
  it('judges by the extra distance, not the distance to the neighbours', () => {
    const uneven = [0, 10, 40, 50].map((lng) => ({ lat: 0, lng }));
    expect(insertIndexFor(uneven, { lat: 0.01, lng: 12 })).toBe(1);
  });
  it('puts a place that lies on two legs at the earlier one', () => {
    expect(insertIndexFor(line, { ...line[1] })).toBe(0);
  });
  it('still judges the legs after one with an unresolved end', () => {
    const longer = [...line, { lat: 0, lng: 40 }];
    expect(insertIndexFor([longer[0], null, longer[2], longer[3], longer[4]], at(25))).toBe(2);
  });
  it('goes first when there are fewer than two points', () => {
    expect(insertIndexFor([], at(5))).toBe(0);
    expect(insertIndexFor([line[0]], at(5))).toBe(0);
  });
  it('skips a leg with an unresolved end, and goes last when none can be judged', () => {
    expect(insertIndexFor([line[0], null, line[2], line[3]], at(5))).toBe(2);
    expect(insertIndexFor([line[0], null, null, line[3]], at(5))).toBe(2);
    expect(insertIndexFor([line[0], line[3]], at(15))).toBe(0);
  });
});

describe('openingVariantIndex', () => {
  const v = (id: string, tone: string) => ({
    id,
    tone,
    label: id,
    places: [],
    finalTravel: { minutes: 1 },
  });
  const route = {
    variants: [v('s1', 'scenic'), v('d', 'direct'), v('s2', 'scenic')],
  } as unknown as Route;

  it('opens on the variant named', () => {
    expect(openingVariantIndex(route, 's2')).toBe(2);
  });
  it('opens on the direct variant when none is named or the one named is gone', () => {
    expect(openingVariantIndex(route, null)).toBe(1);
    expect(openingVariantIndex(route, 'gone')).toBe(1);
  });
  it('opens on the first when there is no direct variant', () => {
    expect(openingVariantIndex({ variants: [v('s1', 'scenic')] } as unknown as Route, null)).toBe(
      0,
    );
  });
});

describe('variant timing for the cards and stop list', () => {
  // 60 min to a waypoint (stopped 20), 30 to a via, 45 to the end.
  const variant = {
    places: [stop(60, 10, { durationMinutes: 20 }), { ...stop(30, 5), kind: 'via' as const }],
    finalTravel: { minutes: 45, miles: 8 },
  };

  it('reads a variant with no recorded travel as zero minutes, not a crash', () => {
    const bare = {
      places: [{ kind: 'waypoint' }],
      finalTravel: undefined,
    } as unknown as RouteVariant;
    expect(variantSplit(bare)).toEqual({ drive: 0, stopped: 15 });
  });

  it('splits the time into road and stops', () => {
    expect(variantSplit(variant)).toEqual({ drive: 135, stopped: 20 });
  });

  it('says when each place and the end is reached, counting earlier stops', () => {
    expect(arrivalMinutes(variant)).toEqual({ places: [60, 110], end: 155 });
    expect(arrivalMinutes({ places: [], finalTravel: { minutes: 30 } })).toEqual({
      places: [],
      end: 30,
    });
  });

  it('shows a clock from any departure', () => {
    expect(exampleClock(37, 8 * 60)).toBe('8:37 AM');
    expect(exampleClock(37, 17 * 60 + 30)).toBe('6:07 PM');
    expect(exampleClock(-30, 8 * 60)).toBe('7:30 AM');
    expect(exampleClock(-9 * 60, 8 * 60)).toBe('11:00 PM');
  });
});

describe('example departure time field', () => {
  it('writes and reads HH:MM', () => {
    expect(toTimeInput(8 * 60)).toBe('08:00');
    expect(toTimeInput(17 * 60 + 5)).toBe('17:05');
    expect(fromTimeInput('08:00')).toBe(480);
    expect(fromTimeInput('17:05')).toBe(1025);
    expect(fromTimeInput(toTimeInput(23 * 60 + 59))).toBe(23 * 60 + 59);
  });
  it('reads nothing from text that is not a time of day', () => {
    expect(fromTimeInput('')).toBeNull();
    expect(fromTimeInput('8:00')).toBeNull();
    expect(fromTimeInput('24:00')).toBeNull();
    expect(fromTimeInput('12:60')).toBeNull();
  });
});

describe('route time and miles ranges', () => {
  const sized = (minutes: number, miles?: number) =>
    ({
      id: String(minutes),
      tone: 'x',
      label: 'x',
      places: [],
      finalTravel: { minutes, miles },
    }) as RouteVariant;
  const route = (...variants: RouteVariant[]) => ({ variants }) as unknown as Route;

  it('gives one value when the variants agree and a range when they differ, in any order', () => {
    expect(routeTimeRange(route(sized(170)))).toBe('2 hr 50 min');
    expect(routeTimeRange(route(sized(210), sized(170)))).toBe('2 hr 50 min – 3 hr 30 min');
    expect(routeMilesRange(route(sized(1, 140), sized(1, 127)))).toBe('127–140 mi');
    expect(routeMilesRange(route(sized(1, 127), sized(1, 127)))).toBe('127 mi');
  });
  it('has nothing without variants, and leaves out distance nobody recorded', () => {
    expect(routeTimeRange(route())).toBeNull();
    expect(routeMilesRange(route(sized(60)))).toBeNull();
    expect(routeMilesRange(route(sized(60, 0), sized(90, 50)))).toBe('50 mi');
  });
});
