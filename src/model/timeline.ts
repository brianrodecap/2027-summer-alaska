// The trip-wide timeline: ONE chronologically sorted list of events computed
// from the trip's data and the reader's current selections — the core of the
// timeline-first design (see the "Timeline First" design artifact). A "day"
// is not part of this at all; it's a slice of `events` by `date`, applied
// later (dayMap.ts's indexTimeline). Because the selections are inputs, an option the reader
// isn't looking at (an inactive scenario branch, a route variant that isn't
// selected, a meal candidate that isn't chosen) simply never appears — there
// is nothing to hide or re-filter afterwards.
//
// Pure and framework-free. Reuses the existing route walk
// (resolveTransitRoute/stageTimesForVariant) and sort keys (activitySortKey)
// rather than re-deriving them, so it agrees with buildTripView wherever the
// two overlap.
import {
  isMealActivity,
  type PackageCarrier,
  packageCarriersOn,
  selectedMealOptions,
} from './mealOptions';
import {
  activityHeadline,
  activityStart,
  activityTimelineStart,
  addDaysStr,
  dateOnly,
  movedBy,
  orderInstant,
  resolveTransitRoute,
  stayOverlapsDay,
  stayZone,
  type TripClock,
  tripClock,
} from './tripModel';
import type {
  MealOption,
  Place,
  ResolvedRouteInfo,
  RouteStage,
  Stay,
  Transit,
  TripData,
} from './types';

export interface TimelineSelections {
  // Already resolved (resolveActiveScenarios): an entity scoped to a scenario
  // only appears when that scenario is in this set.
  activeScenarioIds: ReadonlySet<string>;
  routeTones: ReadonlyMap<string, string>; // transitId -> tone; absent = model default
  mealOptionIndex: ReadonlyMap<string, number>; // activityId -> option; absent = default
}

export type EventKind = 'check-in' | 'check-out' | 'depart' | 'route-stage' | 'arrive' | 'activity';

export interface TimelineEvent {
  id: string; // `${kind}:${sourceId}` (+ `:${stageIndex}`) — one scheme, no per-variant twins
  kind: EventKind;
  at: string; // 'YYYY-MM-DDTHH:mm' wall clock, read on `zone`
  zone: string | null; // the IANA zone `at` is on; null when its place has none
  instant: number; // when it happens (orderInstant): the order every view keeps
  endAt: string | null; // an Activity's start + its explicit duration; null for point events
  date: string; // dateOnly(at): the display bucket, never used for logic
  source: { kind: 'stay' | 'transit' | 'activity'; id: string };
  place: Place | null; // resolved for THESE selections; null = nothing to map
  scenarioId: string | null;
  fuzzy: boolean; // `at` came from a timeLabel anchor rather than a real startAt
  stage?: RouteStage; // a route-stage event's own stage (note, kind, place)
  stageIndex?: number; // a route-stage event's position in its variant's stages
}

export interface Timeline {
  events: TimelineEvent[];
  // transitId -> arrival for the selected route tone (or the authored
  // arrivesAt for an unrouted Transit that has one).
  arrivalOf: ReadonlyMap<string, string>;
  // transitId -> the route walk for these selections (selectedTone = the
  // picked tone, stages timed with the meals actually picked along it).
  routeInfoOf: ReadonlyMap<string, ResolvedRouteInfo>;
  // activityId -> the selected candidate, per still-open meal — the same
  // answer the route walk above used, so a day's overlap and port-call
  // warnings can't disagree with the drive's timing.
  selectedMeals: ReadonlyMap<string, MealOption>;
  // date -> the in-scope Transits/Activities holding Packages that day.
  carriersOn: (date: string) => PackageCarrier[];
}

type TimelineData = Pick<TripData, 'stays' | 'transits' | 'activities' | 'routes'>;

interface Pending {
  event: TimelineEvent;
  headline: string | null; // set for an Activity — its same-instant tie-break key
}

// An Activity tied with a Transit's Depart on the exact same instant happens
// before leaving, so it sorts ahead of the Depart (and isn't folded into the
// drive — see tripModel's routeWalkCandidates). Otherwise only two
// Activities tied on the exact same instant are reordered (a fuzzy one before a real one; two fuzzy ones
// alphabetically). Everything else — including two real-startAt Activities,
// which drag-and-drop deliberately lands on one instant — falls through to
// the stable sort's insertion order (stays, transits, activities, each in
// data order).
function tieBreak(a: Pending, b: Pending): number {
  if (a.event.kind === 'activity' && b.event.kind === 'depart') return -1;
  if (a.event.kind === 'depart' && b.event.kind === 'activity') return 1;
  if (a.headline === null || b.headline === null) return 0;
  if (a.event.fuzzy !== b.event.fuzzy) return a.event.fuzzy ? -1 : 1;
  if (!a.event.fuzzy) return 0;
  return a.headline.localeCompare(b.headline);
}

// Whether an entry on this scenario branch (null: every branch) is in the
// reader's plan.
export function inScope(
  activeScenarioIds: ReadonlySet<string>,
  scenarioId: string | null,
): boolean {
  return scenarioId === null || activeScenarioIds.has(scenarioId);
}

// `clock` is the trip's (tripClock), built once with the view when there is one.
export function buildTimeline(
  data: TimelineData,
  selections: TimelineSelections,
  clock: TripClock = tripClock(data),
): Timeline {
  const { activeScenarioIds, routeTones, mealOptionIndex } = selections;
  const scoped = (scenarioId: string | null) => inScope(activeScenarioIds, scenarioId);
  const routesById = new Map(data.routes.map((r) => [r._id, r]));
  const activities = data.activities.filter((a) => scoped(a.scenarioId));
  const pending: Pending[] = [];
  const arrivalOf = new Map<string, string>();
  const routeInfoOf = new Map<string, ResolvedRouteInfo>();

  // An event's clock is its place's zone unless it says otherwise.
  const push = (
    event: Omit<TimelineEvent, 'date' | 'endAt' | 'fuzzy' | 'zone' | 'instant'> &
      Partial<Pick<TimelineEvent, 'endAt' | 'fuzzy' | 'zone'>>,
    headline: string | null = null,
  ) => {
    const zone = event.zone !== undefined ? event.zone : (event.place?.timeZone ?? null);
    pending.push({
      event: {
        endAt: null,
        fuzzy: false,
        ...event,
        zone,
        instant: orderInstant({ at: event.at, zone }, clock),
        date: dateOnly(event.at),
      },
      headline,
    });
  };

  for (const stay of data.stays as Stay[]) {
    if (!scoped(stay.scenarioId)) continue;
    const place = stay.lodging?.place ?? null;
    const source = { kind: 'stay' as const, id: stay._id };
    const zone = stayZone(stay);
    push({
      id: `check-in:${stay._id}`,
      kind: 'check-in',
      at: stay.checkInAt,
      source,
      place,
      zone,
      scenarioId: stay.scenarioId,
    });
    push({
      id: `check-out:${stay._id}`,
      kind: 'check-out',
      at: stay.checkOutAt,
      source,
      place,
      zone,
      scenarioId: stay.scenarioId,
    });
  }

  const staysOn = new Map<string, Stay[]>();
  const staysForDate = (date: string): Stay[] => {
    let list = staysOn.get(date);
    if (!list) {
      const dayStart = `${date}T00:00`;
      const dayEnd = `${addDaysStr(date, 1)}T00:00`;
      list = (data.stays as Stay[]).filter((s) => stayOverlapsDay(s, dayStart, dayEnd));
      staysOn.set(date, list);
    }
    return list;
  };

  // The selected candidate for every still-open meal, so a lunch stop folded
  // into a drive runs as long as the meal actually picked (a sit-down lunch
  // vs. a drive-thru), not the first candidate's estimate, and sits where
  // that candidate is.
  // Only what's in scope carries a package, as in the day view, and each
  // date's carriers are built once however many meals fall on it.
  const scopedTransits = data.transits.filter((t) => scoped(t.scenarioId));
  const carriersByDate = new Map<string, PackageCarrier[]>();
  const carriersOn = (date: string) => {
    let list = carriersByDate.get(date);
    if (!list) {
      list = packageCarriersOn(scopedTransits, activities, date);
      carriersByDate.set(date, list);
    }
    return list;
  };
  const selectedMeals = selectedMealOptions(activities, staysForDate, carriersOn, mealOptionIndex);

  for (const transit of data.transits as Transit[]) {
    if (!scoped(transit.scenarioId)) continue;
    const source = { kind: 'transit' as const, id: transit._id };
    const common = { source, scenarioId: transit.scenarioId };
    push({
      id: `depart:${transit._id}`,
      kind: 'depart',
      at: transit.departsAt,
      place: transit.from,
      ...common,
    });

    // The route walk's own model default (routeVariant, else the first
    // variant) applies when the reader hasn't picked a tone for this Transit.
    const info = resolveTransitRoute(transit, routesById, activities, clock, {
      routeVariant: routeTones.get(transit._id),
      selectedMeals,
    });
    if (info) routeInfoOf.set(transit._id, info);
    const variant = info?.variants.find((v) => v.tone === info.selectedTone);
    const arrivesAt = variant ? variant.arrivesAt : transit.arrivesAt;
    variant?.stages.forEach((stage, i) =>
      push({
        id: `route-stage:${transit._id}:${i}`,
        kind: 'route-stage',
        at: stage.key,
        zone: stage.zone,
        place: stage.place,
        stage,
        stageIndex: i,
        ...common,
      }),
    );
    if (arrivesAt) {
      arrivalOf.set(transit._id, arrivesAt);
      push({
        id: `arrive:${transit._id}`,
        kind: 'arrive',
        at: arrivesAt,
        // A routed arrival is on the clock its walk reached it on.
        ...(variant ? { zone: variant.arrivesZone } : {}),
        place: transit.to,
        ...common,
      });
    }
  }

  for (const a of activities) {
    const start = activityTimelineStart(a);
    if (!start) continue; // undated: not on the timeline yet
    push(
      {
        id: `activity:${a._id}`,
        kind: 'activity',
        at: start.at,
        endAt:
          a.startAt && a.durationMinutes
            ? movedBy(activityStart(a), a.durationMinutes, clock)
            : null,
        source: { kind: 'activity', id: a._id },
        // A still-open meal is wherever its selected candidate is, so the map,
        // route URLs, travel totals and the row footers all read that answer.
        place: isMealActivity(a) ? (selectedMeals.get(a._id)?.place ?? null) : a.place,
        // Its own clock (activityZone: its clockZone, else its place's), whichever
        // candidate is picked, as scenario anchors read it (activityTimelineStart).
        zone: start.zone,
        scenarioId: a.scenarioId,
        fuzzy: !a.startAt,
      },
      activityHeadline(a),
    );
  }

  const events = pending
    .sort((a, b) => a.event.instant - b.event.instant || tieBreak(a, b))
    .map((p) => p.event);
  return { events, arrivalOf, routeInfoOf, selectedMeals, carriersOn };
}
