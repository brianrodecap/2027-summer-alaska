import { ownTrackCandidates, sectionActivities } from '../../model/tripModel';
import type { Day, EnrichedActivity, ScenarioTrack } from '../../model/types';

// Filters a group of tracks by requiresScenarioId gating against whichever
// scenario is currently active on the followed day — mirrors the old app's
// wireScenarioFollowers "gated" branch: a follower tab whose own
// requires-list doesn't include the followed day's active scenario id is
// dropped outright, not just deselected.
function visibleTracks(
  tracks: ScenarioTrack[],
  followedActiveScenarioId: string | null,
): ScenarioTrack[] {
  const gated = tracks.some((t) => t.scenario.requiresScenarioId);
  if (!gated || !followedActiveScenarioId) return tracks;
  return tracks.filter(
    (t) =>
      !t.scenario.requiresScenarioId ||
      t.scenario.requiresScenarioId.includes(followedActiveScenarioId),
  );
}

// Resolves which of a day's (or a nested group's) scenario tracks is active
// right now — a manual pick always wins; otherwise a top-level group that
// declares followsScenarioDate defaults to (and stays synced with) whichever
// tone is active on the named day, recursively. A nested group (inside
// another track's own sequence) never follows another day — nothing else in
// this trip's data points a followsScenarioDate at a nested scenario, so it
// has no cross-day identity of its own to publish or follow — and its
// picked index is purely local UI state, not centralized selection state.
export function resolveActiveTrack(
  day: Day,
  tracks: ScenarioTrack[],
  daysByDate: Map<string, Day>,
  scenarioTone: Map<string, string>,
  topLevel: boolean,
): ScenarioTrack | null {
  if (!tracks.length) return null;
  const followsDate = topLevel ? (tracks[0].scenario.followsScenarioDate ?? null) : null;

  let followedActiveScenarioId: string | null = null;
  let followedTone: string | null = null;
  if (followsDate) {
    const followedDay = daysByDate.get(followsDate);
    if (followedDay) {
      const followedActive = resolveActiveTrack(
        followedDay,
        followedDay.scenarioTracks,
        daysByDate,
        scenarioTone,
        true,
      );
      if (followedActive) {
        followedActiveScenarioId = followedActive.scenario._id;
        followedTone = followedActive.scenario.tone;
      }
    }
  }

  const gated = tracks.some((t) => t.scenario.requiresScenarioId);
  const visible = visibleTracks(tracks, followedActiveScenarioId);
  if (!visible.length) return null;

  if (topLevel) {
    const manualTone = scenarioTone.get(day.date);
    const manual = manualTone ? visible.find((t) => t.scenario.tone === manualTone) : undefined;
    if (manual) return manual;
  }

  if (gated || !followedTone) return visible[0];
  return visible.find((t) => t.scenario.tone === followedTone) ?? visible[0];
}

// A single active track's own priority-activity candidates, recursing into
// any nested scenario-tabs split's own active track (never an unselected
// sibling — day is unused by resolveActiveTrack when topLevel is false, so
// the enclosing day is passed through as-is rather than needing a synthetic
// one). Shares its own-activities/nested-walk shape with tripModel.ts's
// plannedTrackCandidates via ownTrackCandidates — only which nested track
// gets followed differs (the live selection here, vs. that function's
// sibling-fallback default).
function ownActiveCandidates(
  track: ScenarioTrack,
  day: Day,
  daysByDate: Map<string, Day>,
  scenarioTone: Map<string, string>,
): EnrichedActivity[] {
  return ownTrackCandidates(track, (nestedTracks) => {
    const nestedActive = resolveActiveTrack(day, nestedTracks, daysByDate, scenarioTone, false);
    return nestedActive ? ownActiveCandidates(nestedActive, day, daysByDate, scenarioTone) : [];
  });
}

// A day's own title candidates — fixed backbone plus its active branch's own
// chain — without any cross-day fallback. Also returns the active track
// itself, so a caller one level up can read its followsScenarioDate.
function ownDayTitleCandidates(
  day: Day,
  daysByDate: Map<string, Day>,
  scenarioTone: Map<string, string>,
): { candidates: EnrichedActivity[]; activeTrack: ScenarioTrack | null } {
  const fixed = sectionActivities(day.sequence).filter((a) => a.priority);
  const activeTrack = resolveActiveTrack(day, day.scenarioTracks, daysByDate, scenarioTone, true);
  const own = activeTrack ? ownActiveCandidates(activeTrack, day, daysByDate, scenarioTone) : [];
  return { candidates: [...fixed, ...own], activeTrack };
}

// Day-title candidates for whichever scenario branch this day is currently
// showing — the same track ScenarioTabsSection renders as the active tab —
// rather than tripModel.ts's day.title, which is always the planned
// ideal-or-first branch regardless of what's actually on screen or of a
// scenario deletion that just changed what's available. Includes the fixed
// backbone's own priority activities plus the active branch's own chain, but
// deliberately never an unselected sibling branch: a day whose active branch
// carries no priority activity of its own falls back one hop to whichever
// day its active scenario follows (e.g. Jul 13's "Bonus day — all three
// secured" branch has nothing of its own, so it borrows Jul 12's title) —
// and stops there rather than continuing to walk further back if that
// followed day also comes up empty, so a long chain of quiet days doesn't
// all end up wearing some distant ancestor's headline.
export function activeTitleCandidates(
  day: Day,
  daysByDate: Map<string, Day>,
  scenarioTone: Map<string, string>,
): EnrichedActivity[] {
  const { candidates, activeTrack } = ownDayTitleCandidates(day, daysByDate, scenarioTone);
  if (candidates.length) return candidates;

  const followsDate = activeTrack?.scenario.followsScenarioDate;
  const followedDay = followsDate ? daysByDate.get(followsDate) : undefined;
  if (!followedDay) return candidates;
  return ownDayTitleCandidates(followedDay, daysByDate, scenarioTone).candidates;
}

export function visibleTracksFor(
  tracks: ScenarioTrack[],
  daysByDate: Map<string, Day>,
  scenarioTone: Map<string, string>,
  topLevel: boolean,
): ScenarioTrack[] {
  if (!topLevel) return tracks;
  const followsDate = tracks[0]?.scenario.followsScenarioDate ?? null;
  if (!followsDate) return tracks;
  const followedDay = daysByDate.get(followsDate);
  if (!followedDay) return tracks;
  const followedActive = resolveActiveTrack(
    followedDay,
    followedDay.scenarioTracks,
    daysByDate,
    scenarioTone,
    true,
  );
  return visibleTracks(tracks, followedActive?.scenario._id ?? null);
}
