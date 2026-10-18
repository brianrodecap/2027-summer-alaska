// Live days: the statically built Days (buildTripView — everything the trip
// holds for a date, every scenario branch) re-derived for what the reader has
// actually selected. Resolves the active scenarios from the picks, builds the
// one trip-wide timeline, and lays each date out (layoutDay); every other
// Day field passes through unchanged. Pure — the React hook that feeds it the
// live selections and keeps day identities stable lives with the day list.
import { activeTitleCandidates, followedDayOf, liveHeader } from './dayHeader';
import { layoutDay } from './dayLayout';
import { buildDayVisits, indexTimeline } from './dayMap';
import { uniqueById } from './formatting';
import {
  resolveActiveScenarios,
  type ScenarioGroup,
  scenarioGroups,
  scenarioMembersOn,
  type ScenarioPicks,
} from './scenarioGroups';
import { buildTimeline, inScope, type Timeline } from './timeline';
import { deriveTitle } from './tripModel';
import type {
  BookingShare,
  Day,
  DayFrame,
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  SharesBooking,
  TripData,
  TripView,
} from './types';

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
  // Every Transit, Activity and Stay as the reader is looking at it (route
  // walk, shared bookings narrowed to what they can see) — the same objects
  // the rows carry.
  transitsById: ReadonlyMap<string, EnrichedTransit>;
  activitiesById: ReadonlyMap<string, EnrichedActivity>;
  staysById: ReadonlyMap<string, EnrichedStay>;
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

// Each entry's copy per set of picked sharers, so a rebuild with the same
// picks hands back the same object.
const shareCopies = new WeakMap<object, Map<string, object>>();

interface ShareHolder extends SharesBooking {
  options?: SharesBooking[] | null;
}

type Sharer = BookingShare['sharers'][number];

// An entry and its meal candidates: everything that can share a booking.
const shareHolders = (entry: ShareHolder): SharesBooking[] => [entry, ...(entry.options ?? [])];

// The entry, and its meal candidates, with each shared booking narrowed to
// the sharers the reader can see: the first of them shows it, with their notes.
function withLiveShare<T extends ShareHolder>(entry: T, sees: (s: Sharer) => boolean): T {
  if (!entry.bookingShare && !entry.options?.some((o) => o.bookingShare)) return entry;
  const holders = shareHolders(entry);
  const picked = holders.map((h) => (h.bookingShare?.sharers ?? []).filter(sees));
  if (holders.every((h, i) => (h.bookingShare?.sharers.length ?? 0) === picked[i].length)) {
    return entry;
  }
  const key = picked.map((p) => p.map((s) => s.id).join(',')).join('|');
  const copies = shareCopies.get(entry) ?? new Map<string, object>();
  shareCopies.set(entry, copies);
  const cached = copies.get(key) as T | undefined;
  if (cached) return cached;
  const live = <H extends SharesBooking>(h: H, i: number): H => {
    const share = h.bookingShare;
    const p = picked[i];
    if (!share || p.length === share.sharers.length) return h;
    const firstId = p[0]?.id ?? null;
    return {
      ...h,
      bookingShare: { ...share, firstId, notes: uniqueById(p.flatMap((s) => s.notes)) },
    };
  };
  const copy = {
    ...live(entry, 0),
    ...(entry.options && { options: entry.options.map((o, i) => live(o, i + 1)) }),
  };
  copies.set(key, copy);
  return copy;
}

// `byId` with each entry's live share, the same map when none changes.
function withLiveShares<T extends ShareHolder>(
  byId: ReadonlyMap<string, T>,
  sees: (s: Sharer) => boolean,
): ReadonlyMap<string, T> {
  let live: Map<string, T> | undefined;
  for (const [id, entry] of byId) {
    const shared = withLiveShare(entry, sees);
    if (shared !== entry) (live ??= new Map(byId)).set(id, shared);
  }
  return live ?? byId;
}

export function buildLiveDays(
  view: Pick<TripView, 'days' | 'activitiesById' | 'transitsById' | 'staysById' | 'scenarioNotes'>,
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

  // A sharer on a picked branch, and for a meal candidate, the selected one.
  const sees = (s: Sharer) =>
    inScope(resolved.activeIds, s.scenarioId) &&
    (!s.mealId || timeline.selectedMeals.get(s.mealId)?._id === s.id);
  const transitsById = withLiveShares(liveTransits(view.transitsById, timeline), sees);
  const activitiesById = withLiveShares(view.activitiesById, sees);
  const staysById = withLiveShares(view.staysById, sees);
  const index = indexTimeline(timeline);
  const cache = new Map<string, LiveDayCache>();

  // Pass 1: each date's layout, visits and header (everything but the title).
  const bases = view.days.map((day): { day: DayFrame; base: Day; signature: string } => {
    const events = index.byDate.get(day.date) ?? [];
    const tones = events
      .filter((e) => e.source.kind === 'transit')
      .map((e) => `${e.source.id}=${selections.routeTones.get(e.source.id) ?? ''}`);
    // Each still-open meal's chosen dining format, place and onboard flag — a
    // candidate switch can change any of them without moving an event's place.
    // Part of the signature below, so a new selected-meal field goes here.
    const selectedMealKeys = events
      .filter((e) => e.source.kind === 'activity')
      .map((e) => {
        const meal = timeline.selectedMeals.get(e.source.id);
        const place = meal?.place;
        return `${e.source.id}=${meal?.diningFormat ?? ''}/${place?.id ?? place?.label ?? ''}/${place?.onboard ? 'aboard' : ''}`;
      });
    // Everything a day's rows and visits are built from: its events (with the
    // place each resolved to — a meal's chosen candidate, a route variant's
    // stage), the route variant picked per Transit, and each scenario group's
    // active branch, anchor and members, and each open meal's dining format and place.
    // The stays are fixed by the frame; the packages carried onto the date by
    // in-scope Transits/Activities move with the scenario picks, and decide
    // which meal candidates are active.
    const carriers = timeline.carriersOn(day.date);
    const carrierKeys = carriers.map(
      (c) => `${c.startsAt}:${(c.packages ?? []).map((p) => p._id).join('+')}`,
    );
    // Where each of the day's shared bookings shows, which a pick on another
    // day can move.
    const stays = day.stays.map((st) => staysById.get(st._id) ?? st);
    const entries = new Set<ShareHolder | undefined>(stays);
    for (const { source } of events) {
      if (source.kind === 'activity') entries.add(activitiesById.get(source.id));
      if (source.kind === 'transit') entries.add(transitsById.get(source.id));
    }
    const sharesKey = [...entries]
      .flatMap((e) => (e ? shareHolders(e) : []))
      .flatMap((h) => (h.bookingShare ? [`${h._id}>${h.bookingShare.firstId}`] : []))
      .join(',');
    const signature = [
      events.map((e) => `${e.id}@${e.at}@${e.place?.id ?? e.place?.label ?? ''}`).join(','),
      tones.join(','),
      groupsSignature(groups, day.date),
      selectedMealKeys.join(','),
      carrierKeys.join(','),
      sharesKey,
    ].join('|');

    const hit = previous?.get(day.date);
    if (hit && hit.staticDay === day && hit.signature === signature) {
      return { day, base: hit.base, signature };
    }

    const dayStayIds = new Set(stays.map((st) => st._id));
    const membersOfScenario = (id: string) => {
      const members = scenarioMembersOn(data, id, day.date);
      return { ...members, stayIds: members.stayIds.filter((sid) => dayStayIds.has(sid)) };
    };
    const layout = layoutDay({
      date: day.date,
      events,
      groups,
      stays,
      activities: activitiesById,
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
      stays,
      // The live Transits, so everything reading day.transits — the rows'
      // live "during transit" check (liveWarnings) above all —
      // rechecks when the route tab or a meal along the drive changes.
      transits: day.transits.map((t) => transitsById.get(t._id) ?? t),
      ...header,
      rows: layout.rows,
      scenarioTracks: layout.scenarioTracks,
      visits: buildDayVisits({ date: day.date, rows: layout.rows, index }),
      selectedMeals: timeline.selectedMeals,
      mealCarriers: carriers,
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
  return { days, transitsById, activitiesById, staysById, cache };
}
