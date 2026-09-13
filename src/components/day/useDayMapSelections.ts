import { useMemo } from 'react';

import { activeMealOptions, isMealActivity } from '../../model/mealOptions';
import type { Day, DaySelections, Place, SequenceItem } from '../../model/types';
import {
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from '../../state/useTripSelections';

// Only activities the reader has actually switched away from the model's
// default candidate get an entry here — dayMapStops/dayFullRouteUrls/
// dayMapPlaces (tripModel.ts) already fall back to the first place-bearing
// option on their own for anything left out of this map, same as the
// model's own "planned by default" convention.
function collectMealPlaces(
  day: Day,
  mealOptionIndex: Map<string, number>,
): Map<string, Place | null> {
  const result = new Map<string, Place | null>();
  const walk = (sequence: SequenceItem[]) => {
    for (const item of sequence) {
      if (item.type === 'section') {
        for (const activity of item.activities) {
          if (!isMealActivity(activity) || !mealOptionIndex.has(activity._id)) continue;
          const options = activeMealOptions(activity, day);
          const option = options[mealOptionIndex.get(activity._id) as number];
          if (option) result.set(activity._id, option.place);
        }
      } else if (item.type === 'scenario-tabs') {
        for (const track of item.tracks ?? day.scenarioTracks) walk(track.sequence);
      }
    }
  };
  walk(day.sequence);
  return result;
}

// The live scenario/route/meal selections every day-map view (the modal
// DayMapPanel, the persistent DayMapSidebar) needs to resolve the same
// "what's actually being looked at right now" a reader may have switched
// away from the model's own default — shared so both views stay in sync
// with the same live state instead of drifting apart. Takes `day: Day |
// null` (rather than requiring a caller to skip the hook while there's no
// day to show yet — a dialog not yet opened, or DayMapSidebar before
// useActiveDayDate has picked one) since every call site reads this before
// its own "nothing to show yet" early return, and React hooks can't be
// called conditionally.
export function useDayMapSelections(day: Day | null): DaySelections {
  const { scenarioTone } = useScenarioSelection();
  const { routeTones } = useRouteToneSelection();
  const { mealOptionIndex } = useMealOptionSelection();
  const dateTone = day ? scenarioTone.get(day.date) : undefined;
  // Stable across renders as long as day/dateTone/routeTones/mealOptionIndex
  // don't actually change — callers (DayMapSidebar's dayMapRouteNodes/stops
  // useMemos) key off this object's identity, which a fresh literal every
  // render would defeat.
  return useMemo(
    () => ({
      scenarioTone: dateTone,
      routeTones,
      mealPlaces: day ? collectMealPlaces(day, mealOptionIndex) : undefined,
    }),
    [day, dateTone, routeTones, mealOptionIndex],
  );
}
