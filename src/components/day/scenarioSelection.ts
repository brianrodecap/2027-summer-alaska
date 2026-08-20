import type { Day, ScenarioTrack } from '../../model/types';

// Filters a group of tracks by requiresScenarioId gating against whichever
// scenario is currently active on the followed day — mirrors the old app's
// wireScenarioFollowers "gated" branch: a follower tab whose own
// requires-list doesn't include the followed day's active scenario id is
// dropped outright, not just deselected.
function visibleTracks(tracks: ScenarioTrack[], followedActiveScenarioId: string | null): ScenarioTrack[] {
  const gated = tracks.some((t) => t.scenario.requiresScenarioId);
  if (!gated || !followedActiveScenarioId) return tracks;
  return tracks.filter(
    (t) => !t.scenario.requiresScenarioId || t.scenario.requiresScenarioId.includes(followedActiveScenarioId),
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
      const followedActive = resolveActiveTrack(followedDay, followedDay.scenarioTracks, daysByDate, scenarioTone, true);
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
  const followedActive = resolveActiveTrack(followedDay, followedDay.scenarioTracks, daysByDate, scenarioTone, true);
  return visibleTracks(tracks, followedActive?.scenario._id ?? null);
}
