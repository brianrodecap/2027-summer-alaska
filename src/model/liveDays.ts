// Live days: the statically built Days (buildTripView — everything the trip
// holds for a date, every scenario branch) re-derived for what the reader has
// actually selected. Resolves the active scenarios from the picks, builds the
// one trip-wide timeline, and lays each date out (layoutDay); every other
// Day field passes through unchanged. Pure — the React hook that feeds it the
// live selections and keeps day identities stable lives with the day list.
import { activeTitleCandidates, followedDayOf, liveHeader } from './dayHeader';
import { layoutDay } from './dayLayout';
import { buildDayVisits, indexTimeline } from './dayMap';
import {
  resolveActiveScenarios,
  type ScenarioGroup,
  scenarioGroups,
  scenarioMembersOn,
  type ScenarioPicks,
} from './scenarioGroups';
import { buildTimeline, type Timeline } from './timeline';
import { deriveTitle } from './tripModel';
import type { Day, DayFrame, EnrichedTransit, TripData, TripView } from './types';

export interface LiveSelections {
  scenarioPicks: ScenarioPicks;
  routeTones: ReadonlyMap<string, string>;
  mealOptionIndex: ReadonlyMap<string, number>;
}

// What was computed for one date last time, so an unrelated selection change
// elsewhere in the (unvirtualized, ~28-day) list hands back the very same Day
// object — DayAccordion is memoized on it.
export interface LiveDayCache {
  staticDay: DayFrame;
  signature: string;
  base: Day; // everything but the title, which may borrow a followed day's
  live: Day;
}

export interface LiveDays {
  days: Day[];
  // Every Transit as the reader is looking at it (see liveTransits) — the
  // same objects the rows and day.transits carry.
  transitsById: ReadonlyMap<string, EnrichedTransit>;
  cache: Map<string, LiveDayCache>;
}

function groupsSignature(groups: ScenarioGroup[], date: string): string {
  return groups
    .filter((g) => g.anchorAtByDate[date] !== undefined)
    .map(
      (g) => `${g.key}:${g.activeId}:${g.anchorAtByDate[date]}:${g.membersByDate[date]?.join(',')}`,
    )
    .join(';');
}

// buildTripView's Transits carry their default route variant, walked with
// default meal formats. This swaps in the timeline's live walk — routeInfo
// (selectedTone = the picked tab, stages timed with the meals actually
// picked) and arrivesAt — so every reader of a Transit (its rows, the header,
// day.transits' overlap checks, the detail sheet) sees one live answer
// instead of choosing between a default copy and a live lookup. A Transit
// the timeline didn't touch (out of scope, nothing to patch) keeps its object.
function liveTransits(
  transits: ReadonlyMap<string, EnrichedTransit>,
  timeline: Timeline,
): Map<string, EnrichedTransit> {
  const live = new Map<string, EnrichedTransit>();
  for (const [id, t] of transits) {
    const routeInfo = timeline.routeInfoOf.get(id);
    const arrivesAt = timeline.arrivalOf.get(id);
    live.set(
      id,
      routeInfo || (arrivesAt && arrivesAt !== t.arrivesAt)
        ? { ...t, routeInfo: routeInfo ?? t.routeInfo, arrivesAt: arrivesAt ?? t.arrivesAt }
        : t,
    );
  }
  return live;
}

export function buildLiveDays(
  view: Pick<TripView, 'days' | 'activitiesById' | 'transitsById' | 'scenarioNotes'>,
  data: TripData,
  selections: LiveSelections,
  previous?: Map<string, LiveDayCache>,
): LiveDays {
  const resolved = resolveActiveScenarios(data, selections.scenarioPicks);
  const groups = scenarioGroups(data, resolved);
  const timeline = buildTimeline(data, {
    activeScenarioIds: resolved.activeIds,
    routeTones: selections.routeTones,
    mealOptionIndex: selections.mealOptionIndex,
  });

  const transitsById = liveTransits(view.transitsById, timeline);
  const index = indexTimeline(timeline);
  const cache = new Map<string, LiveDayCache>();

  // Pass 1: each date's layout, visits and header (everything but the title).
  const bases = view.days.map((day): { day: DayFrame; base: Day; signature: string } => {
    const events = index.byDate.get(day.date) ?? [];
    const tones = events
      .filter((e) => e.source.kind === 'transit')
      .map((e) => `${e.source.id}=${selections.routeTones.get(e.source.id) ?? ''}`);
    // The dining format each of the day's still-open meals resolved to — a
    // candidate switch can change it without moving any event's place.
    const formats = events
      .filter((e) => e.source.kind === 'activity')
      .map((e) => `${e.source.id}=${timeline.formatOverrides.get(e.source.id) ?? ''}`);
    // Everything a day's rows and visits are built from: its events (with the
    // place each resolved to — a meal's chosen candidate, a route variant's
    // stage), the route variant picked per Transit, and each scenario group's
    // active branch, anchor and members, and each open meal's dining format.
    // The stays are fixed by the frame.
    const signature = [
      events.map((e) => `${e.id}@${e.at}@${e.place?.id ?? e.place?.label ?? ''}`).join(','),
      tones.join(','),
      groupsSignature(groups, day.date),
      formats.join(','),
    ].join('|');

    const hit = previous?.get(day.date);
    if (hit && hit.staticDay === day && hit.signature === signature) {
      return { day, base: hit.base, signature };
    }

    const dayStayIds = new Set(day.stays.map((st) => st._id));
    const membersOfScenario = (id: string) => {
      const members = scenarioMembersOn(data, id, day.date);
      return { ...members, stayIds: members.stayIds.filter((sid) => dayStayIds.has(sid)) };
    };
    const layout = layoutDay({
      date: day.date,
      events,
      groups,
      stays: day.stays,
      activities: view.activitiesById,
      transits: transitsById,
      notesForScenario: (s) => view.scenarioNotes.get(s._id) ?? [],
      membersOfScenario,
    });
    const header = liveHeader({
      frame: day,
      rows: layout.rows,
      scenarioTracks: layout.scenarioTracks,
      activeScenarioIds: resolved.activeIds,
      transits: transitsById.values(),
      arrivalOf: timeline.arrivalOf,
    });
    const base: Day = {
      ...day,
      // The live Transits, so everything reading day.transits — the rows'
      // live "during transit" check (liveOverlapWarnings) above all —
      // rechecks when the route tab or a meal along the drive changes.
      transits: day.transits.map((t) => transitsById.get(t._id) ?? t),
      ...header,
      rows: layout.rows,
      scenarioTracks: layout.scenarioTracks,
      visits: buildDayVisits({ date: day.date, rows: layout.rows, index }),
      mealFormats: timeline.formatOverrides,
      title: '', // filled in by pass 2
    };
    return { day, base, signature };
  });

  // Pass 2: titles. A day whose active branch has nothing of its own borrows
  // the day its scenario follows, so this needs every day's layout first.
  const baseByDate = new Map(bases.map(({ base }) => [base.date, base]));
  const days = bases.map(({ day, base, signature }): Day => {
    const title = deriveTitle(
      base.location,
      activeTitleCandidates(base, followedDayOf(base, baseByDate)),
    );
    const hit = previous?.get(day.date);
    const live =
      hit && hit.base === base && hit.live.title === title ? hit.live : { ...base, title };
    cache.set(day.date, { staticDay: day, signature, base, live });
    return live;
  });
  return { days, transitsById, cache };
}
