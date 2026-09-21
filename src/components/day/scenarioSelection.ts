import type { ScenarioTrack } from '../../model/types';

// A day's top-level strip can list the tabs of more than one eligible group
// (two groups sharing a date whose gates are both satisfied); each group is
// its own independent choice, so each gets its own strip.
export function tracksByGroup(tracks: ScenarioTrack[]): ScenarioTrack[][] {
  const groups = new Map<string, ScenarioTrack[]>();
  for (const track of tracks) {
    const key = track.groupKey;
    const list = groups.get(key);
    if (list) list.push(track);
    else groups.set(key, [track]);
  }
  return [...groups.values()];
}
