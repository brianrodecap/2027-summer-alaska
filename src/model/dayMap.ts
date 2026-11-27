// Map, route and travel queries for one day, read off the day's own laid-out
// rows (layoutDay). A day's "visits" are the places it touches in order — its
// stays, its transit events, its activities — already resolved for the
// reader's current selections (the selected route variant's stages, the chosen
// meal candidate, only the active scenario branches), so none of the queries
// below carries any selection state or has anything to hide or widen:
//   - a Transit that crosses midnight contributes ALL its events to both
//     days' visits (its other-day events come from the timeline index);
//   - a route variant that isn't selected, a scenario branch that isn't
//     active, a meal candidate that isn't chosen, never exist to begin with.
//
// A routed drive's own Depart/Arrive endpoints are left out unless the
// Transit opts in (transitPhaseOnMap) — they're usually a whole city or
// park, so its selected variant's stages carry the drive instead.
//
// Output rules: the day list's Stay check-outs first and check-ins last (the
// same split the list uses), a same-day excursion's interior dropped, a
// genuine one-way relocation splitting the day into separate drivable runs.
// Everything else is in the list's own order, so an Activity reached mid-drive
// on the arrival day of an overnight Transit sits between the Transit's stages
// and its Arrive, rather than ahead of the whole widened Transit.
import { rowOrder } from './dayLayout';
import { sameName } from './formatting';
import type { Timeline, TimelineEvent } from './timeline';
import {
  activityNodeKey,
  buildDirectionsUrl,
  type DayMapPlaceRef,
  type DayMapRouteNode,
  type DayTravelSegment,
  dedupeDayMapPlaceStops,
  diffMinutesIso,
  findNextResolvableStop,
  MAX_ROUTE_WAYPOINTS,
  type RouteStop,
  routeStop,
  segmentKey,
  splitOutStayBoundaries,
  stageNodeKey,
  stayNodeKey,
  transitBoundaryKey,
  transitPhaseOnMap,
} from './tripModel';
import type {
  DayRow,
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  Place,
  RouteStage,
  StayRelation,
  Transit,
  TransitBoundaryRow,
} from './types';

export type DayVisit =
  | {
      kind: 'stay';
      stay: EnrichedStay;
      relation: StayRelation;
      place: Place;
      key: string;
      order: number;
    }
  | {
      kind: 'transit';
      transit: EnrichedTransit;
      phase: 'depart' | 'arrive';
      place: Place;
      key: string;
      order: number;
    }
  | {
      kind: 'stage';
      transit: EnrichedTransit;
      stage: RouteStage;
      stageIndex: number;
      place: Place;
      key: string;
      order: number;
    }
  | { kind: 'activity'; activity: EnrichedActivity; place: Place; key: string; order: number };

// A visit that has no row on this day: the other day's part of a Transit that
// crosses midnight.
type OffDay = { offDay?: boolean };

export interface DayVisits {
  date: string;
  checkOuts: DayVisit[]; // unscoped Stay check-outs — always the day's first stops
  checkIns: DayVisit[]; // unscoped check-ins and stays in progress — always its last
  rest: (DayVisit & OffDay)[]; // everything else, in the order it happens
}

export interface DayVisitsInput {
  date: string;
  // The day's laid-out rows (layoutDay) — the one place the display order, the
  // active scenario branches and the stay-boundary pinning are decided.
  rows: DayRow[];
  // Built once per timeline (see indexTimeline), shared by every day.
  index: TimelineIndex;
}

export interface TimelineIndex {
  order: ReadonlyMap<TimelineEvent, number>; // position in the timeline's own sort
  byTransit: ReadonlyMap<string, TimelineEvent[]>;
  byDate: ReadonlyMap<string, TimelineEvent[]>;
}

export function indexTimeline(timeline: Timeline): TimelineIndex {
  const order = new Map<TimelineEvent, number>();
  const byTransit = new Map<string, TimelineEvent[]>();
  const byDate = new Map<string, TimelineEvent[]>();
  timeline.events.forEach((event, i) => {
    order.set(event, i);
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
    if (event.source.kind === 'transit') {
      const own = byTransit.get(event.source.id);
      if (own) own.push(event);
      else byTransit.set(event.source.id, [event]);
    }
  });
  return { order, byTransit, byDate };
}

function rowVisits(row: DayRow): DayVisit[] {
  switch (row.type) {
    case 'stay': {
      const place = row.stay.lodging?.place;
      if (!place) return [];
      return [
        {
          kind: 'stay',
          stay: row.stay,
          relation: row.relation,
          place,
          key: row.key,
          order: rowOrder(row),
        },
      ];
    }
    case 'activity':
      return row.event.place
        ? [
            {
              kind: 'activity',
              activity: row.activity,
              place: row.event.place,
              key: row.key,
              order: rowOrder(row),
            },
          ]
        : [];
    case 'transit': {
      const place = row.event.place;
      if (!place || !transitPhaseOnMap(row.transit, row.phase)) return [];
      return row.phase === 'stage'
        ? [
            {
              kind: 'stage',
              transit: row.transit,
              stage: row.stage,
              stageIndex: row.stageIndex,
              place,
              key: row.key,
              order: rowOrder(row),
            },
          ]
        : [
            {
              kind: 'transit',
              transit: row.transit,
              phase: row.phase,
              place,
              key: row.key,
              order: rowOrder(row),
            },
          ];
    }
    // A scenario box contributes only the branches on screen, in the list's order:
    // each branch's check-outs first and check-ins last, the rest as they happen
    // (nested boxes flatten into the outermost one).
    case 'box': {
      const branches = row.tracks
        .filter((track) => track.active)
        .map((track) => splitOutStayBoundaries(track.rows));
      return [
        ...branches.flatMap((b) => b.checkOuts),
        ...branches.flatMap((b) => b.rest).sort((a, b) => rowOrder(a) - rowOrder(b)),
        ...branches.flatMap((b) => b.checkIns),
      ].flatMap(rowVisits);
    }
  }
}

// Every Transit a row list (and its active boxes) touches.
function transitsIn(rows: DayRow[], into = new Map<string, EnrichedTransit>()) {
  for (const row of rows) {
    if (row.type === 'transit') into.set(row.transit._id, row.transit);
    else if (row.type === 'box') {
      for (const track of row.tracks) if (track.active) transitsIn(track.rows, into);
    }
  }
  return into;
}

function eventVisit(event: TimelineEvent, transit: EnrichedTransit): DayVisit | null {
  if (!event.place) return null;
  if (event.kind === 'route-stage') {
    return event.stage && event.stageIndex !== undefined
      ? {
          kind: 'stage',
          transit,
          stage: event.stage,
          stageIndex: event.stageIndex,
          place: event.place,
          key: event.at,
          order: event.instant,
        }
      : null;
  }
  const phase = event.kind === 'depart' ? 'depart' : 'arrive';
  if (!transitPhaseOnMap(transit, phase)) return null;
  return {
    kind: 'transit',
    transit,
    phase,
    place: event.place,
    key: event.at,
    order: event.instant,
  };
}

// The places a day touches, read off its own laid-out rows so the map, route
// URL and travel totals can never disagree with the list about what is on the
// day or in what order. Stay check-outs and check-ins are pinned to the day's
// edges by the same split the list uses (splitOutStayBoundaries).
//
// The one thing rows can't say is a Transit that crosses midnight: it
// contributes ALL its events to both days' visits, so its origin and
// destination are reachable from either. Its events on the other day are
// added here — before the day's own places if earlier, after them if later.
export function buildDayVisits({ date, rows, index }: DayVisitsInput): DayVisits {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(rows);
  const dayStart = `${date}T00:00`;
  const before: (DayVisit & OffDay)[] = [];
  const after: (DayVisit & OffDay)[] = [];
  for (const [id, transit] of transitsIn(rest)) {
    for (const event of index.byTransit.get(id) ?? []) {
      if (event.date === date) continue; // already a row of this day
      const visit = eventVisit(event, transit);
      if (visit) (event.at < dayStart ? before : after).push({ ...visit, offDay: true });
    }
  }
  return {
    date,
    checkOuts: checkOuts.flatMap(rowVisits),
    checkIns: checkIns.flatMap(rowVisits),
    rest: [...before, ...rest.flatMap(rowVisits), ...after],
  };
}

// ---------- drivable runs ----------

// A flight or a ferry: it runs to its own schedule, from its Depart straight
// to its Arrive, so nothing between those two is driven.
export const isScheduled = (transit: Pick<Transit, 'mode'>) => transit.mode !== 'drive';

const isNonDriveBoundary = (v: DayVisit): v is Extract<DayVisit, { kind: 'transit' }> =>
  v.kind === 'transit' && isScheduled(v.transit);

// Whether two transit endpoints are one place: the same place id when both
// have one, else exactly the same name.
function sameEndpoint(a: Place, b: Place): boolean {
  return a.id && b.id ? a.id === b.id : sameName(a.label, b.label);
}

// A same-day "there and back" excursion (a floatplane day trip, a shuttle past
// a private-vehicle closure): an outbound non-drive `depart` from A to B, and
// a later `arrive` back from B to A. Returns each pair's [out, back] span. A
// connection (A to B, then B on to C) isn't one: it never comes back. Every
// depart stays open until an arrive comes back from it, so a connection
// earlier in the day doesn't hide a later excursion; an arrive closes the
// latest one it returns from, and any opened after it.
function excursionPairs(visits: DayVisit[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const open: { index: number; transit: EnrichedTransit }[] = [];
  visits.forEach((visit, i) => {
    if (!isNonDriveBoundary(visit)) return;
    if (visit.phase === 'depart') {
      open.push({ index: i, transit: visit.transit });
      return;
    }
    let k = open.length - 1;
    while (
      k >= 0 &&
      !(
        sameEndpoint(visit.transit.from, open[k].transit.to) &&
        sameEndpoint(visit.transit.to, open[k].transit.from)
      )
    ) {
      k -= 1;
    }
    if (k < 0) return;
    pairs.push([open[k].index, i]);
    open.splice(k);
  });
  return pairs;
}

// The maximal chronological runs that are mutually reachable by driving,
// dropping each excursion's interior. A genuine relocation — a non-drive
// boundary outside any excursion pair, e.g. a one-way flight — starts a new
// run: nothing before it and nothing after it share a road network.
function drivableRuns(visits: DayVisit[]): DayVisit[][] {
  const pairs = excursionPairs(visits);
  const starts = new Set(pairs.map(([start]) => start));
  const ends = new Set(pairs.map(([, end]) => end));
  const runs: DayVisit[][] = [[]];
  visits.forEach((visit, i) => {
    if (pairs.some(([start, end]) => i > start && i < end)) return;
    const relocation = isNonDriveBoundary(visit) && !starts.has(i) && !ends.has(i);
    if (relocation && visit.phase === 'arrive') runs.push([]);
    runs[runs.length - 1].push(visit);
    if (relocation && visit.phase === 'depart') runs.push([]);
  });
  return runs.filter((run) => run.length > 0);
}

// Bookends the FIRST run with the day's check-outs (and the stay it woke up
// in) and the LAST with its check-ins, then collapses immediate repeats and
// drops any run left empty.
function bookendedRuns<T>(
  visits: DayVisits,
  toStops: (visits: DayVisit[]) => T[],
  sameStop: (a: T, b: T) => boolean,
): T[][] {
  const morning = visits.checkIns.filter((v) => v.kind === 'stay' && v.relation === 'Staying');
  const runs = drivableRuns(visits.rest);
  const segments = (runs.length ? runs : [[]]).map(toStops);
  segments[0] = [...toStops(morning), ...toStops(visits.checkOuts), ...segments[0]];
  segments[segments.length - 1] = [...segments[segments.length - 1], ...toStops(visits.checkIns)];
  return segments
    .map((stops) => stops.filter((stop, i) => i === 0 || !sameStop(stop, stops[i - 1])))
    .filter((stops) => stops.length > 0);
}

// ---------- the day list's hops past a scheduled transit ----------

// A Depart or Arrive row, as much of it as scheduledHop reads.
type BoundaryAt = Pick<TransitBoundaryRow, 'phase'> & {
  transit: Pick<Transit, 'mode' | 'from' | 'to'>;
  event: Pick<TimelineEvent, 'at'>;
};

// What the day list shows between a row and the next one when the first is
// a scheduled transit's (isScheduled) Depart or Arrive, in place of the
// drive between them:
//   - 'aboard': from its Depart, the transit itself carries the party, so
//     there's no drive to look up;
//   - 'connection': its Arrive straight into the Depart of another of the
//     same mode, flying on from where it landed (not back to where it left:
//     that's an excursion's return), is a layover — the time between them,
//     not a drive.
// null for an ordinary drive.
export type ScheduledHop = { kind: 'aboard' } | { kind: 'connection'; minutes: number };

export function scheduledHop(
  from: BoundaryAt | undefined,
  to: BoundaryAt | undefined,
): ScheduledHop | null {
  if (!from || !isScheduled(from.transit)) return null;
  if (from.phase === 'depart') return { kind: 'aboard' };
  if (
    to?.phase === 'depart' &&
    to.transit.mode === from.transit.mode &&
    sameEndpoint(to.transit.from, from.transit.to) &&
    !sameEndpoint(to.transit.to, from.transit.from)
  ) {
    const minutes = diffMinutesIso(from.event.at, to.event.at);
    // One leaving before the other lands isn't a connection to show.
    if (minutes > 0) return { kind: 'connection', minutes };
  }
  return null;
}

// A day-list row, as much of it as rowHop reads: the place it's entered and
// left at, and — for a transit's Depart or Arrive — that row.
interface HopRow {
  entryPlace: Place | null;
  exitPlace: Place | null;
  boundary?: BoundaryAt;
}

// What leads from `rows[i]` to the next stop in the day list: its scheduledHop, else
// travel from its place to `next`'s, the next row with a resolved place. Rows with
// none are walked past so they don't dead-end their real neighbors, but never past a
// flight's or ferry's own Depart or Arrive (resolved or not), which no drive
// crosses; drivableRuns splits the day there the same way. null when there is
// nothing to show: nothing reachable, the same place, or the next stop is a scheduled
// transit's Arrive (the row is mid-flight: a route stage, an activity aboard).
export function rowHop<R extends HopRow>(
  rows: R[],
  i: number,
):
  | { kind: 'aboard' }
  | { kind: 'connection'; minutes: number; next: R }
  | { kind: 'travel'; from: Place; to: Place; next: R }
  | null {
  const row = rows[i];
  const next = findNextResolvableStop(
    rows,
    i,
    (r) => !!r.entryPlace?.id || (!!r.boundary && isScheduled(r.boundary.transit)),
  );
  const hop = scheduledHop(row.boundary, next?.boundary);
  // a connection is always to the row it was read against
  if (hop) return hop.kind === 'connection' ? { ...hop, next: next as R } : hop;
  if (next?.boundary?.phase === 'arrive' && isScheduled(next.boundary.transit)) return null;
  const from = row.exitPlace;
  const to = next?.entryPlace;
  if (!next || !from?.id || !to?.id || from.id === to.id) return null;
  return { kind: 'travel', from, to, next };
}

// Whether the party is carried between two adjacent map nodes by a scheduled
// transit (isScheduled), not driven: it leaves from that transit's Depart or
// one of its route stages, or arrives at its Arrive. The map draws no route
// line there, the same way rowHop shows no travel line.
export function isAboardHop(from: DayMapRouteNode, to: DayMapRouteNode): boolean {
  const { ref: out } = from;
  const { ref: into } = to;
  const boardedAt =
    out.kind === 'transit-stage' || (out.kind === 'transit' && out.phase === 'depart');
  const arrivesAt = into.kind === 'transit' && into.phase === 'arrive';
  return (boardedAt && isScheduled(out.entity)) || (arrivesAt && isScheduled(into.entity));
}

// ---------- queries ----------

// Only a place with a resolved Google place id is ever a map stop, in every
// query below. A bare label goes to Google's text search, which resolves it
// however it likes — "Discovery Princess" (a cruise ship) and "Main Dining
// Room" (an onboard venue) both land in California. Unresolved visits stay in
// DayVisits itself, though: a flight's "Kotzebue (OTZ)" endpoint is still
// what splits the day into separate drivable runs (drivableRuns), so the
// filter applies per run, after that split.
const resolved = (list: DayVisit[]) => list.filter((v) => v.place.id);

// Plain labels, one list per drivable run. Route stages are left out: the
// keyless embed only ever draws start -> end, and mis-plots when fed
// waypoints via daddr's "+to:" chaining.
export function mapStopLabels(visits: DayVisits): string[][] {
  return bookendedRuns(
    visits,
    (list) =>
      resolved(list)
        .filter((v) => v.kind !== 'stage')
        .map((v) => v.place.label),
    (a, b) => a === b,
  );
}

export function mapEmbedUrls(visits: DayVisits): string[] {
  return mapStopLabels(visits).map((stops) => {
    if (stops.length === 1) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(stops[0])}&output=embed`;
    }
    const start = encodeURIComponent(stops[0]);
    const end = encodeURIComponent(stops[stops.length - 1]);
    return `https://maps.google.com/maps?saddr=${start}&daddr=${end}&output=embed`;
  });
}

// The key the map and the day's totals look up a visit's travel-mode override by.
// None for a stay in progress, so they route its hops as drives.
function visitNodeKey(visit: DayVisit, date: string): string | null {
  switch (visit.kind) {
    case 'stay':
      return visit.relation === 'Staying' ? null : stayNodeKey(visit.stay._id, date);
    case 'activity':
      return activityNodeKey(visit.activity._id);
    case 'stage':
      return stageNodeKey(visit.transit._id, visit.stageIndex);
    case 'transit':
      return transitBoundaryKey(visit.transit._id, visit.phase);
  }
}

function routeStops(visits: DayVisits): RouteStop[][] {
  return bookendedRuns(
    visits,
    (list) => resolved(list).flatMap((v) => routeStop(v.place, visitNodeKey(v, visits.date)) ?? []),
    (a, b) => a.label === b.label,
  );
}

export function routeUrls(visits: DayVisits): string[] {
  return routeStops(visits).flatMap((stops) => {
    if (stops.length < 2) return [];
    const urls: string[] = [];
    let originIndex = 0;
    while (originIndex < stops.length - 1) {
      const destinationIndex = Math.min(originIndex + MAX_ROUTE_WAYPOINTS + 1, stops.length - 1);
      urls.push(
        buildDirectionsUrl(
          stops[originIndex],
          stops[destinationIndex],
          stops.slice(originIndex + 1, destinationIndex),
        ),
      );
      originIndex = destinationIndex;
    }
    return urls;
  });
}

// Every drivable hop between two consecutive stops with different place ids
// (every RouteStop already has a resolved id — see `resolved`). The day-list rows' own
// travel lines pair stops a different way, via tripModel's `findNextResolvableStop`.
export function travelSegments(visits: DayVisits): DayTravelSegment[] {
  return routeStops(visits).flatMap((stops) =>
    stops.slice(0, -1).flatMap((stop, i): DayTravelSegment[] => {
      const next = stops[i + 1];
      if (stop.placeId === next.placeId) return [];
      const hopKey = stop.nodeKey && next.nodeKey ? segmentKey(stop.nodeKey, next.nodeKey) : null;
      return [{ originId: stop.placeId, destinationId: next.placeId, segmentKey: hopKey }];
    }),
  );
}

// One node per chronological occurrence of a place that has a real id (never
// deduped — the route line needs a place visited twice drawn twice), each
// with the reference the map sidebar uses to open the matching row's detail.
export function mapRouteNodes(visits: DayVisits): DayMapRouteNode[] {
  const nodes: DayMapRouteNode[] = [];
  const all: (DayVisit & OffDay)[] = [...visits.checkOuts, ...visits.rest, ...visits.checkIns];
  for (const v of all) {
    if (!v.place.id) continue;
    const shared = {
      place: v.place,
      nodeKey: visitNodeKey(v, visits.date),
      ...(v.offDay ? { offDay: true } : {}),
    };
    switch (v.kind) {
      case 'stay':
        nodes.push({
          ...shared,
          order: v.order,
          at: v.key,
          ref: { kind: 'stay', entity: v.stay, relation: v.relation, rowKey: v.key },
        });
        break;
      case 'transit':
        nodes.push({
          ...shared,
          order: v.order,
          at: v.key,
          ref: { kind: 'transit', entity: v.transit, phase: v.phase, rowKey: v.key },
        });
        break;
      case 'stage':
        nodes.push({
          ...shared,
          order: v.order,
          at: v.key,
          ref: {
            kind: 'transit-stage',
            entity: v.transit,
            stage: v.stage,
            stageIndex: v.stageIndex,
            rowKey: v.key,
          },
        });
        break;
      case 'activity':
        nodes.push({
          ...shared,
          order: v.order,
          at: v.key,
          ref: { kind: 'activity', entity: v.activity },
        });
        break;
    }
  }
  return nodes;
}

// What a row's card and its map pin are called. The row's drag key, except for a
// stay: that key names only the day, so a card also needs the row's own time (a
// day room has both its check-in and check-out), and the morning card of a stay in
// progress its own name.
export const stayRowId = (stayId: string, at: string) => stayNodeKey(stayId, at);
export const stayMorningRowId = (stayId: string) => stayNodeKey(stayId, 'morning');

export function mapRefRowId(ref: DayMapPlaceRef): string {
  if (ref.kind === 'stay') return stayRowId(ref.entity._id, ref.rowKey);
  if (ref.kind === 'transit') return transitBoundaryKey(ref.entity._id, ref.phase);
  if (ref.kind === 'transit-stage') return stageNodeKey(ref.entity._id, ref.stageIndex);
  return activityNodeKey(ref.entity._id);
}

// The day's numbered rows, in the day list's order: every map node with a row on
// this day, plus the morning card of each stay in progress, which opens its own
// list — the day's, or its plan's (the map's route only ends there).
function pinSequence(visits: DayVisits): { id: string; ref: DayMapPlaceRef }[] {
  const nodes = mapRouteNodes(visits).filter((node) => !node.offDay);
  // Morning cards not yet placed, by the plan (or null, the day) whose list they open.
  const mornings = new Map<string | null, { id: string; ref: DayMapPlaceRef }[]>();
  for (const { ref } of nodes) {
    if (ref.kind !== 'stay' || ref.relation !== 'Staying') continue;
    const plan = ref.entity.scenarioId;
    mornings.set(plan, [
      ...(mornings.get(plan) ?? []),
      { id: stayMorningRowId(ref.entity._id), ref },
    ]);
  }
  const opening = (plan: string | null) => {
    const cards = mornings.get(plan) ?? [];
    mornings.delete(plan);
    return cards;
  };
  return [
    ...opening(null),
    ...nodes.flatMap(({ ref }) => [
      ...opening(ref.entity.scenarioId),
      { id: mapRefRowId(ref), ref },
    ]),
  ];
}

// The day map's number for each row it shows, by row id: counting up in the list's
// order, never reused. A row the map leaves out (no real place, a routed drive's
// own ends) has none.
export function mapPinNumbers(visits: DayVisits): Map<string, number> {
  return new Map(pinSequence(visits).map(({ id }, i): [string, number] => [id, i + 1]));
}

// The day map's pins, one per place, each with the numbers of every row there.
export function numberedMapStops(visits: DayVisits) {
  const numbers = new Map<string, number[]>();
  pinSequence(visits).forEach(({ ref }, i) => {
    const refId = mapRefRowId(ref);
    numbers.set(refId, [...(numbers.get(refId) ?? []), i + 1]);
  });
  return dedupeDayMapPlaceStops(mapRouteNodes(visits)).map((stop) => ({
    stop,
    numbers: [...new Set(stop.refs.map(mapRefRowId))]
      .flatMap((id) => numbers.get(id) ?? [])
      .sort((a, b) => a - b),
  }));
}

// A pin's numbers as it prints them, a run written as a range: "1–2, 7".
export function pinLabel(numbers: number[]): string {
  const runs: [number, number][] = [];
  for (const n of numbers) {
    const run = runs.at(-1);
    if (run && n === run[1] + 1) run[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`)).join(', ');
}
