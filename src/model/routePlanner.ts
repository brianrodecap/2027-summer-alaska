import { formatMinutes } from './formatting';
import type { Coordinates } from './placeCoordinates';
import { DEFAULT_ROUTE_TONE, pickVariant, routePlaceStopMinutes } from './tripModel';
import type { Route, RoutePlaceEntry, RouteVariant } from './types';

// Drive time (stops included) and distance of one variant, straight from the
// stored travel: the same numbers the timeline's stage walk spends.
export function variantSummary(variant: Pick<RouteVariant, 'places' | 'finalTravel'>) {
  const { places, finalTravel } = variant;
  const minutes = previewTotal(previewSteps(variant));
  const miles =
    places.reduce((sum, p) => sum + (p.travel?.miles ?? 0), 0) + (finalTravel?.miles ?? 0);
  return {
    minutes,
    miles: Math.round(miles),
    stops: places.filter((p) => p.kind === 'waypoint').length,
  };
}

// Which of the theme's routeVariants colors a variant draws in: the direct
// one is always 0, and the scenic ones alternate 1, 2, 1, ... in order.
export function variantColorIndex(variants: Pick<RouteVariant, 'tone'>[], index: number): number {
  if (variants[index].tone === DEFAULT_ROUTE_TONE) return 0;
  const scenicBefore = variants.slice(0, index).filter((v) => v.tone !== DEFAULT_ROUTE_TONE);
  return 1 + (scenicBefore.length % 2);
}

// The theme color a variant draws in, from its `routeVariants` list.
export function variantColor(
  colors: readonly string[],
  variants: Pick<RouteVariant, 'tone'>[],
  index: number,
): string {
  return colors[variantColorIndex(variants, index)];
}

// Every place id a route touches: its ends and each variant's places.
export function routePlaceIds(route: Route): string[] {
  return [
    route.from.id,
    route.to.id,
    ...route.variants.flatMap((v) => v.places.map((p) => p.place?.id)),
  ].filter((id): id is string => Boolean(id));
}

// The resolved points of those places; one with no coordinates yet is left out.
export function routePoints(route: Route, coords: ReadonlyMap<string, Coordinates>): Coordinates[] {
  return routePlaceIds(route).flatMap((id) => coords.get(id) ?? []);
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function boundsOf(points: Coordinates[]): Bounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

// shortcut: no antimeridian wrap, so a route box or a map view spanning 180°
// reads as empty; fine for a road trip, upgrade if one ever crosses the Aleutians.
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

// Web Mercator on a 0..1 square, so a pixel is a fixed distance at a given zoom.
const toWorld = ({ lat, lng }: Coordinates) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};
const fromWorld = ({ x, y }: { x: number; y: number }): Coordinates => ({
  lng: x * 360 - 180,
  lat: ((2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI,
});

const MAX_MITER = 3;

// The path shifted `pixels` to the right of its direction of travel as drawn
// at `zoom` (negative: left), so several variants that share a road sit side
// by side instead of hiding one another. A vertex leans on the average of the
// directions in and out of it; a repeated point or an exact U-turn, where that
// average vanishes, takes the direction of whichever segment is left. The shift
// is stretched by the miter at a bend so the gap between lines holds there too.
export function offsetPath(path: Coordinates[], pixels: number, zoom: number): Coordinates[] {
  if (pixels === 0 || path.length < 2) return path;
  const world = path.map(toWorld);
  const directions = world
    .slice(1)
    .map((b, i) => unit({ x: b.x - world[i].x, y: b.y - world[i].y }));
  const first = directions.find((d) => d);
  if (!first) return path;
  const distance = pixels / (256 * 2 ** zoom);
  return world.map((p, i) => {
    const before = directions[i - 1];
    const after = directions[i];
    const d = unit({
      x: (before?.x ?? 0) + (after?.x ?? 0),
      y: (before?.y ?? 0) + (after?.y ?? 0),
    });
    const { x, y } = d ?? before ?? after ?? first;
    // Pushed out by the miter, 1 / cos(half the turn), so the lines keep their gap
    // at a bend; capped so a near U-turn does not throw a spike.
    const miter =
      d && before && after
        ? Math.min(MAX_MITER, 2 / Math.hypot(before.x + after.x, before.y + after.y))
        : 1;
    // Rotated a quarter turn to the right (the map's y axis points south).
    return fromWorld({ x: p.x - y * distance * miter, y: p.y + x * distance * miter });
  });
}

function unit({ x, y }: { x: number; y: number }) {
  const length = Math.hypot(x, y);
  return length > 1e-12 ? { x: x / length, y: y / length } : null;
}

// A variant's ends and places in driving order; null where a place has no id.
export function variantPlaceIds(route: Route, variant: RouteVariant): (string | null)[] {
  return [route.from.id, ...variant.places.map((p) => p.place?.id ?? null), route.to.id];
}

// Those as points; null where there is no id or no coordinates yet, so legs
// still line up with the places.
export function variantPoints(
  route: Route,
  variant: RouteVariant,
  coords: ReadonlyMap<string, Coordinates>,
): (Coordinates | null)[] {
  return variantPlaceIds(route, variant).map((id) => (id ? (coords.get(id) ?? null) : null));
}

// Which legs head away from where the drive is going: leg i runs from point i
// to point i+1, and doubles back when it moves against the direction from the
// first point to the last. A round trip has no such direction, and a leg with
// an unresolved end can't be judged, so neither is flagged.
export function doublingBack(points: (Coordinates | null)[]): boolean[] {
  const none = points.slice(1).map(() => false);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return none;
  const a = toWorld(first);
  const b = toWorld(last);
  const axis = { x: b.x - a.x, y: b.y - a.y };
  return none.map((_, i) => {
    const from = points[i];
    const to = points[i + 1];
    if (!from || !to) return false;
    const p = toWorld(from);
    const q = toWorld(to);
    return (q.x - p.x) * axis.x + (q.y - p.y) * axis.y < 0;
  });
}

const EARTH_MILES = 3958.8;

export function straightMiles(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

export function pathMiles(points: Coordinates[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + straightMiles(points[i], p), 0);
}

const MIN_MILES_SAVED = 1;

// The order of `stops` (each entry the index of the stop that goes there) that
// makes the shortest drive from `from` to `to`, or the order given when nothing
// is shorter by MIN_MILES_SAVED. shortcut: straight-line distances, and more than 8
// stops keep their order; upgrade to drive times if it misorders a winding
// road, and to a heuristic if routes ever grow past 8 stops.
export function optimizeOrder(from: Coordinates, to: Coordinates, stops: Coordinates[]): number[] {
  const identity = stops.map((_, i) => i);
  if (stops.length < 2 || stops.length > 8) return identity;
  const length = (order: number[]) => pathMiles([from, ...order.map((i) => stops[i]), to]);
  let best = identity;
  let bestLength = length(identity) - MIN_MILES_SAVED;
  const search = (order: number[], left: number[]) => {
    if (!left.length) {
      const total = length(order);
      if (total < bestLength) [best, bestLength] = [order, total];
      return;
    }
    left.forEach((i, k) => search([...order, i], [...left.slice(0, k), ...left.slice(k + 1)]));
  };
  search([], identity);
  return best;
}

// A place entry as a waypoint or a via. A via is a pass-through with no stop, so
// it keeps no stop time.
export function withStopKind(
  entry: RoutePlaceEntry,
  kind: RoutePlaceEntry['kind'],
): RoutePlaceEntry {
  const { durationMinutes, ...rest } = entry;
  return kind === 'waypoint' ? { ...rest, kind, durationMinutes } : { ...rest, kind };
}

// A place entry with the stop time typed into a field: blank leaves it to the
// default, anything else is the number typed (the route's own validation turns
// away a negative or a non-number).
export function withStopMinutes(entry: RoutePlaceEntry, text: string): RoutePlaceEntry {
  const { durationMinutes: _, ...rest } = entry;
  return text.trim() === '' ? rest : { ...rest, durationMinutes: Number(text) };
}

// The variant of a proposed route to preview: the one it revised (`revisedId`, if the
// draft changed it), else
// the one variant of `tone` the base route doesn't already have. Null when that
// leaves more than one, or none, rather than a guess.
export function draftVariantId(
  route: Route,
  base: Route | null,
  tone: string,
  revisedId?: string,
): string | null {
  // Revised only if it really differs from the route it was drafted for.
  const revised = route.variants.find((v) => v.id === revisedId);
  const before = base?.variants.find((v) => v.id === revisedId);
  if (revised && JSON.stringify(revised) !== JSON.stringify(before)) return revised.id;
  const added = route.variants.filter(
    (v) => v.tone === tone && !base?.variants.some((b) => b.id === v.id),
  );
  return added.length === 1 ? added[0].id : null;
}

// ---------- Preview: a variant driven end to end, timed from its stored drive times

// One leg and the stop at its end: the drive to a place (to the route's end for
// the last), then the time spent at that place, which a via, and the end, don't have.
export interface PreviewStep {
  drive: number;
  stop: number;
  place: number | null;
}

export function previewSteps(variant: Pick<RouteVariant, 'places' | 'finalTravel'>): PreviewStep[] {
  const { places, finalTravel } = variant;
  return [
    ...places.map((p, i) => ({
      drive: p.travel?.minutes ?? 0,
      stop: routePlaceStopMinutes(p),
      place: i,
    })),
    { drive: finalTravel?.minutes ?? 0, stop: 0, place: null },
  ];
}

export const previewTotal = (steps: PreviewStep[]): number =>
  steps.reduce((sum, s) => sum + s.drive + s.stop, 0);

// Where `minute` into the trip falls: partway (`fraction`) along drive leg `leg`, or,
// when `stop` is set, stopped at that place.
export interface PreviewState {
  leg: number;
  fraction: number;
  stop: number | null;
}

export function previewState(steps: PreviewStep[], minute: number): PreviewState {
  let left = Math.max(0, minute);
  for (const [leg, step] of steps.entries()) {
    if (left < step.drive) return { leg, fraction: left / step.drive, stop: null };
    left -= step.drive;
    if (left < step.stop) return { leg, fraction: 1, stop: step.place };
    left -= step.stop;
  }
  return { leg: steps.length - 1, fraction: 1, stop: null };
}

// The point `fraction` of the way along a path, by distance.
export function pointOnPath(path: Coordinates[], fraction: number): Coordinates {
  if (fraction <= 0) return path[0];
  let left = fraction * pathMiles(path);
  for (let i = 1; i < path.length; i++) {
    const length = straightMiles(path[i - 1], path[i]);
    if (left <= length) {
      const t = length ? left / length : 1;
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
      };
    }
    left -= length;
  }
  return path[path.length - 1];
}

// The example departure the planner starts from: 8:00 AM, as minutes into the day.
export const DEFAULT_EXAMPLE_DEPARTURE = 8 * 60;

// A made-up clock for the preview and the stop list: `minute` into a drive that
// departs at `departure` (minutes into the day).
// A time past midnight carries the number of days on, "+1".
export function exampleClock(minute: number, departure = DEFAULT_EXAMPLE_DEPARTURE): string {
  const total = departure + Math.round(minute);
  const m = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const days = Math.floor(total / (24 * 60));
  const h = Math.floor(m / 60);
  const clock = `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return days > 0 ? `${clock} +${days}` : clock;
}

// ---------- Filters for the route list

export type RouteFilter = 'needsPlaces' | 'hasScenic' | 'doublesBack';

// Every variant is just From and To, with no places in between — likely unfinished
// data entry. A route with no variants yet has nothing to check, so it is not flagged.
export function needsPlaces(route: Route): boolean {
  return route.variants.length > 0 && route.variants.every((v) => v.places.length === 0);
}

export const hasScenic = (route: Route): boolean =>
  route.variants.some((v) => v.tone !== DEFAULT_ROUTE_TONE);

export const routeDoublesBack = (route: Route, coords: ReadonlyMap<string, Coordinates>): boolean =>
  route.variants.some((v) => doublingBack(variantPoints(route, v, coords)).some(Boolean));

// A route passes when it meets every active filter; with none active, all pass.
export function matchesFilters(
  route: Route,
  active: ReadonlySet<RouteFilter>,
  coords: ReadonlyMap<string, Coordinates>,
): boolean {
  return (
    (!active.has('needsPlaces') || needsPlaces(route)) &&
    (!active.has('hasScenic') || hasScenic(route)) &&
    (!active.has('doublesBack') || routeDoublesBack(route, coords))
  );
}

// A range of values written as one when they agree ("2 hr 50 min – 3 hr 30 min").
function rangeText(values: number[], show: (n: number) => string, joiner: string): string {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  return low === high ? show(low) : `${show(low)}${joiner}${show(high)}`;
}

// How long a route takes: one time, or a range across its variants. Null for a route
// with no variants.
export function routeTimeRange(route: Route): string | null {
  if (!route.variants.length) return null;
  return rangeText(
    route.variants.map((v) => variantSummary(v).minutes),
    formatMinutes,
    ' – ',
  );
}

// How far it is, likewise ("114–133 mi"). A variant with no distance recorded is left
// out, and null when none has one.
export function routeMilesRange(route: Route): string | null {
  const known = route.variants.map((v) => variantSummary(v).miles).filter((m) => m > 0);
  return known.length ? `${rangeText(known, String, '–')} mi` : null;
}

// Where a place clicked on the map goes in a variant's list: between the two
// neighbours (the start, each place, the end) it adds the least distance to, as an
// index into the places. A neighbour with no coordinates yet can't be judged; with
// nothing to judge, the place goes last.
export function insertIndexFor(points: (Coordinates | null)[], at: Coordinates): number {
  let best = points.length - 2;
  let least = Infinity;
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    if (!a || !b) continue;
    const extra = straightMiles(a, at) + straightMiles(at, b) - straightMiles(a, b);
    if (extra < least) {
      least = extra;
      best = k;
    }
  }
  return Math.max(0, best);
}

// The index of the variant a planner opens on: the one named, else the direct one,
// else the first (a route with no direct variant is not valid, but opens anyway).
export function openingVariantIndex(route: Route, variantId: string | null): number {
  return Math.max(0, route.variants.indexOf(pickVariant(route.variants, variantId)!));
}

// How a variant's time divides: minutes on the road, and minutes stopped at waypoints.
export function variantSplit(variant: Pick<RouteVariant, 'places' | 'finalTravel'>) {
  const steps = previewSteps(variant);
  return {
    drive: steps.reduce((sum, s) => sum + s.drive, 0),
    stopped: steps.reduce((sum, s) => sum + s.stop, 0),
  };
}

// Minutes after departure at which each place is reached, and the route's end is.
export function arrivalMinutes(variant: Pick<RouteVariant, 'places' | 'finalTravel'>) {
  let clock = 0;
  const places: number[] = [];
  const steps = previewSteps(variant);
  for (const step of steps.slice(0, -1)) {
    clock += step.drive;
    places.push(clock);
    clock += step.stop;
  }
  return { places, end: clock + steps[steps.length - 1].drive };
}

// An example departure as the "HH:MM" an <input type="time"> uses, and back. Text that
// is not a time of day gives null, so a half-typed field leaves the departure alone.
export const toTimeInput = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function fromTimeInput(text: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
