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
import { buildTimeline } from './timeline';
import { deriveTitle } from './tripModel';
import type { Day, DayFrame, TripData, TripView } from './types';

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

  const index = indexTimeline(timeline);
  const cache = new Map<string, LiveDayCache>();

  // Pass 1: each date's layout, visits and header (everything but the title).
  const bases = view.days.map((day): { day: DayFrame; base: Day; signature: string } => {
    const events = index.byDate.get(day.date) ?? [];
    const tones = events
      .filter((e) => e.source.kind === 'transit')
      .map((e) => `${e.source.id}=${selections.routeTones.get(e.source.id) ?? ''}`);
    // Everything a day's rows and visits are built from: its events (with the
    // place each resolved to — a meal's chosen candidate, a route variant's
    // stage), the route variant picked per Transit, and each scenario group's
    // active branch, anchor and members. The stays are fixed by the frame.
    const signature = [
      events.map((e) => `${e.id}@${e.at}@${e.place?.id ?? e.place?.label ?? ''}`).join(','),
      tones.join(','),
      groupsSignature(groups, day.date),
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
      transits: view.transitsById,
      notesForScenario: (s) => view.scenarioNotes.get(s._id) ?? [],
      membersOfScenario,
    });
    const header = liveHeader({
      frame: day,
      rows: layout.rows,
      scenarioTracks: layout.scenarioTracks,
      activeScenarioIds: resolved.activeIds,
      transits: view.transitsById.values(),
      arrivalOf: timeline.arrivalOf,
    });
    const base: Day = {
      ...day,
      ...header,
      rows: layout.rows,
      scenarioTracks: layout.scenarioTracks,
      visits: buildDayVisits({ date: day.date, rows: layout.rows, index }),
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
  return { days, cache };
}
