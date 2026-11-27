import { activeTrackOf } from '../../model/tripModel';
import type { ScenarioTrack } from '../../model/types';

// The color of a day's pins and route line: the route planner's line colors, the
// ideal plan's (or a day with no plans) first and a picked alternate's second.
export function planColor(colors: readonly string[], tracks: ScenarioTrack[]): string {
  return colors[activeTrackOf(tracks)?.scenario.tone === 'alternate' ? 1 : 0];
}
