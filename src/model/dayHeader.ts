// A day's header — its location, summary, title and the places its live
// weather/sunrise/sunset strip reads — derived from the LIVE layout (the
// active scenario branches' rows), so it follows what the reader has
// selected rather than always describing the planned branch.
import {
  activeTrackOf,
  activitiesOf,
  dateOnly,
  deriveSummary,
  followedScenarioId,
  orderedPlaceIds,
  ownTrackCandidates,
  pickByPriority,
} from './tripModel';
import type {
  Day,
  DayRow,
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  ScenarioTrack,
} from './types';

// Small readers of "the active branch" out of a live Day's tracks
// (activeTrackOf, tripModel.ts), so none of them re-derives the gating or the
// picks themselves.

// The scenario id the day's active top-level branch resolves to, or null when
// the day has none (no scenario tracks, or every group gated out).
export function resolveActiveScenarioId(day: Pick<Day, 'scenarioTracks'> | null): string | null {
  return day ? (activeTrackOf(day.scenarioTracks)?.scenario._id ?? null) : null;
}

type TitleSource = Pick<Day, 'rows' | 'scenarioTracks'>;

// A single active track's own priority-activity candidates, recursing into any
// nested scenario-tabs split's own active track (never an unselected sibling).
function ownActiveCandidates(track: ScenarioTrack): EnrichedActivity[] {
  return ownTrackCandidates(track, (nestedTracks) => {
    const nestedActive = activeTrackOf(nestedTracks);
    return nestedActive ? ownActiveCandidates(nestedActive) : [];
  });
}

// A day's own title candidates — the fixed backbone's priority activities plus
// its active branch's own chain — without any cross-day fallback. Also returns
// the active track itself, so the caller can read which scenario it follows.
function ownDayCandidates(day: TitleSource): {
  candidates: EnrichedActivity[];
  activeTrack: ScenarioTrack | null;
} {
  const fixed = activitiesOf(day.rows).filter((a) => a.priority);
  const activeTrack = activeTrackOf(day.scenarioTracks);
  const own = activeTrack ? ownActiveCandidates(activeTrack) : [];
  return { candidates: [...fixed, ...own], activeTrack };
}

// The day a day's active scenario narratively follows, if any — looked up by
// scenario id, never by a stored calendar date, so a follower tracks the
// followed scenario's content moving to a new date (see followedScenarioId).
export function followedDayOf<D extends Pick<Day, 'scenarioTracks'>>(
  day: D,
  daysByDate: ReadonlyMap<string, D>,
): D | null {
  const activeTrack = activeTrackOf(day.scenarioTracks);
  const followsId = activeTrack ? followedScenarioId(activeTrack.scenario) : null;
  if (!followsId) return null;
  for (const candidate of daysByDate.values()) {
    if (candidate.scenarioTracks.some((t) => t.scenario._id === followsId)) return candidate;
  }
  return null;
}

// Title candidates for whichever scenario branch this day is currently
// showing — the same track ScenarioTabsSection renders as the active tab.
// Includes the backbone's priority activities plus the active branch's own
// chain, but never an unselected sibling. A day whose active branch carries no
// priority activity of its own falls back one hop to the day its active
// scenario follows (`followedDay`; e.g. Jul 13's "Bonus day — all three
// secured" branch has nothing of its own, so it borrows Jul 12's title) — and
// stops there rather than walking further back, so a long chain of quiet days
// doesn't all end up wearing some distant ancestor's headline.
export function activeTitleCandidates(
  day: TitleSource,
  followedDay: TitleSource | null,
): EnrichedActivity[] {
  const { candidates } = ownDayCandidates(day);
  if (candidates.length || !followedDay) return candidates;
  return ownDayCandidates(followedDay).candidates;
}

export interface LiveHeaderInput {
  frame: Pick<Day, 'date' | 'leg' | 'legIds' | 'stays' | 'transits'>;
  rows: DayRow[];
  scenarioTracks: ScenarioTrack[];
  activeScenarioIds: ReadonlySet<string>;
  transits: Iterable<EnrichedTransit>; // every trip transit — for "who arrives here"
  arrivalOf: ReadonlyMap<string, string>; // the selected variant's arrival, per in-scope transit
}

export type LiveHeader = Pick<
  Day,
  'location' | 'sunrisePlaceId' | 'sunsetPlaceId' | 'weatherPlaceId' | 'summary'
>;

// The first value that is actually present, in order — the `a ?? b ?? c` chain
// as a list, so a long fallback chain is one call instead of a branch per link.
function firstPresent<T>(values: Array<T | null | undefined>): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value;
  return null;
}

// The stay whose checkout is today but check-in wasn't (only touching this day
// on the way out) is skipped in favor of wherever the day actually ends up.
// When more than one scenario's Stay claims the same night, an unscoped Stay
// wins outright (it happens whichever branch is taken), otherwise the active
// branch's own.
function primaryStayOf(
  frame: Pick<Day, 'date' | 'stays'>,
  activeScenarioIds: ReadonlySet<string>,
): EnrichedStay | null {
  const { date, stays } = frame;
  const eligible = stays.filter(
    (s) => !(dateOnly(s.checkOutAt) === date && dateOnly(s.checkInAt) !== date),
  );
  return pickByPriority(
    eligible,
    (s) => !s.scenarioId,
    (s) => Boolean(s.scenarioId && activeScenarioIds.has(s.scenarioId)),
  );
}

// Looked up against every one of the day's legs' Transits, not just the ones
// departing today — a day with nothing else to name itself after still needs
// to know one arrived here.
function arrivingTransitOf(
  frame: Pick<Day, 'date' | 'legIds'>,
  transits: Iterable<EnrichedTransit>,
  arrivalOf: ReadonlyMap<string, string>,
): EnrichedTransit | undefined {
  const legIds = new Set(frame.legIds);
  for (const transit of transits) {
    const arrival = arrivalOf.get(transit._id);
    if (legIds.has(transit.legId) && arrival && dateOnly(arrival) === frame.date) return transit;
  }
  return undefined;
}

// What names the day: the stay it ends in, else where a Transit arrives, else
// where one departs, else the leg. The label and the place id each take the
// first candidate that HAS one, independently.
function locationOf(
  frame: Pick<Day, 'leg' | 'transits'>,
  primaryStay: EnrichedStay | null,
  arriving: EnrichedTransit | undefined,
): { label: string; placeId: string | null } {
  const places = [primaryStay?.lodging?.place, arriving?.to, frame.transits[0]?.from];
  return {
    label: firstPresent(places.map((p) => p?.label)) ?? frame.leg.name,
    placeId: firstPresent(places.map((p) => p?.id)),
  };
}

// Everything in a day's header except its title (which may borrow a followed
// day's, so it needs every day's layout first — see buildLiveDays).
export function liveHeader(input: LiveHeaderInput): LiveHeader {
  const { frame, rows, scenarioTracks } = input;
  const primaryStay = primaryStayOf(frame, input.activeScenarioIds);
  const arriving = arrivingTransitOf(frame, input.transits, input.arrivalOf);
  const location = locationOf(frame, primaryStay, arriving);

  // Sunrise/sunset track wherever the day actually starts and ends — the
  // first/last place with a resolvable id in the day's own rows.
  const dayPlaceIds = orderedPlaceIds(rows);
  // The high/low temperature follows the same priority the header title does
  // (a flightseeing day's weather is the flightseeing spot's, not the
  // hotel's), falling back to the day's own default location.
  const candidates = ownDayCandidates({ rows, scenarioTracks }).candidates;
  return {
    location: location.label,
    sunrisePlaceId: dayPlaceIds[0] ?? null,
    sunsetPlaceId: dayPlaceIds[dayPlaceIds.length - 1] ?? null,
    weatherPlaceId: candidates.find((a) => a.place?.id)?.place?.id ?? location.placeId,
    summary: deriveSummary({ scenarioTracks, rows, stays: frame.stays, location: location.label }),
  };
}
