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
import { resolveActivityPlace } from './mealOptions';
import {
  activityHeadline,
  activityTimelineKey,
  addDaysStr,
  addMinutesIso,
  dateOnly,
  resolveTransitRoute,
  stayOverlapsDay,
} from './tripModel';
import type { Place, RouteStage, Stay, Transit, TripData } from './types';

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
  at: string; // 'YYYY-MM-DDTHH:mm' wall clock; the ONLY sort key
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
}

type TimelineData = Pick<TripData, 'stays' | 'transits' | 'activities' | 'routes'>;

interface Pending {
  event: TimelineEvent;
  headline: string | null; // set for an Activity — its same-instant tie-break key
}

// Same rule as tripModel's activityTieBreak: only two Activities tied on the
// exact same instant are reordered (a fuzzy one before a real one; two fuzzy
// ones alphabetically). Everything else — including two real-startAt
// Activities, which drag-and-drop deliberately lands on one instant — falls
// through to the stable sort's insertion order (stays, transits, activities,
// each in data order).
function tieBreak(a: Pending, b: Pending): number {
  if (a.headline === null || b.headline === null) return 0;
  if (a.event.fuzzy !== b.event.fuzzy) return a.event.fuzzy ? -1 : 1;
  if (!a.event.fuzzy) return 0;
  return a.headline.localeCompare(b.headline);
}

export function buildTimeline(data: TimelineData, selections: TimelineSelections): Timeline {
  const { activeScenarioIds, routeTones, mealOptionIndex } = selections;
  const inScope = (scenarioId: string | null) =>
    scenarioId === null || activeScenarioIds.has(scenarioId);
  const routesById = new Map(data.routes.map((r) => [r._id, r]));
  const activities = data.activities.filter((a) => inScope(a.scenarioId));
  const pending: Pending[] = [];
  const arrivalOf = new Map<string, string>();

  const push = (
    event: Omit<TimelineEvent, 'date' | 'endAt' | 'fuzzy'> &
      Partial<Pick<TimelineEvent, 'endAt' | 'fuzzy'>>,
    headline: string | null = null,
  ) =>
    pending.push({
      event: { endAt: null, fuzzy: false, ...event, date: dateOnly(event.at) },
      headline,
    });

  for (const stay of data.stays as Stay[]) {
    if (!inScope(stay.scenarioId)) continue;
    const place = stay.lodging?.place ?? null;
    const source = { kind: 'stay' as const, id: stay._id };
    push({
      id: `check-in:${stay._id}`,
      kind: 'check-in',
      at: stay.checkInAt,
      source,
      place,
      scenarioId: stay.scenarioId,
    });
    push({
      id: `check-out:${stay._id}`,
      kind: 'check-out',
      at: stay.checkOutAt,
      source,
      place,
      scenarioId: stay.scenarioId,
    });
  }

  for (const transit of data.transits as Transit[]) {
    if (!inScope(transit.scenarioId)) continue;
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
    const info = resolveTransitRoute(transit, routesById, activities, {
      routeVariant: routeTones.get(transit._id),
    });
    const variant = info?.variants.find((v) => v.tone === info.selectedTone);
    const arrivesAt = variant ? variant.arrivesAt : transit.arrivesAt;
    variant?.stages.forEach((stage, i) =>
      push({
        id: `route-stage:${transit._id}:${i}`,
        kind: 'route-stage',
        at: stage.key,
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
        place: transit.to,
        ...common,
      });
    }
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

  for (const a of activities) {
    const key = activityTimelineKey(a);
    if (!key) continue; // undated: not on the timeline yet
    const { date, at } = key;
    push(
      {
        id: `activity:${a._id}`,
        kind: 'activity',
        at,
        endAt: a.startAt && a.durationMinutes ? addMinutesIso(a.startAt, a.durationMinutes) : null,
        source: { kind: 'activity', id: a._id },
        place: resolveActivityPlace(a, staysForDate(date), date, mealOptionIndex),
        scenarioId: a.scenarioId,
        fuzzy: !a.startAt,
      },
      activityHeadline(a),
    );
  }

  const events = pending
    .sort((a, b) => {
      // Plain string comparison, like the day rows' own sort — the timestamps
      // share one fixed-width format, and locale collation isn't wanted here.
      if (a.event.at !== b.event.at) return a.event.at < b.event.at ? -1 : 1;
      return tieBreak(a, b);
    })
    .map((p) => p.event);
  return { events, arrivalOf };
}
