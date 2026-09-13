import { useMemo } from 'react';

import { activeMealOptions, isMealActivity } from '../../model/mealOptions';
import type { Day, DaySelections, Place, SequenceItem } from '../../model/types';
import {
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from '../../state/useTripSelections';

const EMPTY_ID_SET: Set<string> = new Set();

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

// Collects just the ids this one day's own sequence actually references —
// transit ids (routeTones is keyed by transitId) and meal-activity ids
// (mealOptionIndex is keyed by activityId) — so useStableFilteredMap below
// can scope each trip-wide selection Map down to only what this day cares
// about.
function dayRelevantIds(day: Day): { transitIds: Set<string>; mealActivityIds: Set<string> } {
  const transitIds = new Set<string>();
  const mealActivityIds = new Set<string>();
  const walk = (sequence: SequenceItem[]) => {
    for (const item of sequence) {
      if (item.type === 'transit-boundary' || item.type === 'transit-stage') {
        transitIds.add(item.transit._id);
      } else if (item.type === 'section') {
        for (const activity of item.activities) {
          if (isMealActivity(activity)) mealActivityIds.add(activity._id);
        }
      } else if (item.type === 'scenario-tabs') {
        for (const track of item.tracks ?? day.scenarioTracks) walk(track.sequence);
      }
    }
  };
  walk(day.sequence);
  return { transitIds, mealActivityIds };
}

// Filters `source` down to just `ids`, but keeps returning the exact same
// Map instance across renders as long as every one of those ids' own values
// is unchanged. `routeTones`/`mealOptionIndex` (TripSelectionsContext's
// useMapSlot) get a fresh identity on *any* selection change anywhere in the
// trip, not just one relevant to this day — without this, useDayMapSelections
// below (now mounted once per day via DayTravelChip, not just once for
// whichever single day a map view has open) would hand every one of those
// ~28 days a new DaySelections object, and everything downstream keyed off
// its identity (DayTravelChip's own segment-list useMemo, DayMapSidebar's
// route-node useMemo) would recompute on a toggle that touched a completely
// different day. Built entirely from a plain string `signature` — encoding
// every relevant (id, value) pair — as useMemo's sole dependency, the same
// "collapse a fresh-every-render key into one stable dependency string"
// idiom this file's sibling DayMapSidebar.tsx's own useVisibleTestIds (its
// idsKey) already uses, rather than a ref-based memo: mutating a ref during
// render (the more obvious way to hand-roll this) is disallowed by this
// project's react-hooks/refs lint rule.
function useStableFilteredMap<V>(source: Map<string, V>, ids: Set<string>): Map<string, V> {
  const entries: [string, V][] = [];
  for (const id of ids) {
    const value = source.get(id);
    if (value !== undefined) entries.push([id, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signature = entries.map(([id, value]) => `${id}=${String(value)}`).join('|');
  // entries is fresh every render; signature is its stable "same ids, same
  // values" identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(entries), [signature]);
}

// The live scenario/route/meal selections every day-map view (the modal
// DayMapPanel, the persistent DayMapSidebar, and DayTravelChip's own
// drive-time total) needs to resolve the same "what's actually being looked
// at right now" a reader may have switched away from the model's own default
// — shared so all three stay in sync with the same live state instead of
// drifting apart. Takes `day: Day | null` (rather than requiring a caller to
// skip the hook while there's no day to show yet — a dialog not yet opened,
// or DayMapSidebar before useActiveDayDate has picked one) since every call
// site reads this before its own "nothing to show yet" early return, and
// React hooks can't be called conditionally.
export function useDayMapSelections(day: Day | null): DaySelections {
  const { scenarioTone } = useScenarioSelection();
  const { routeTones } = useRouteToneSelection();
  const { mealOptionIndex } = useMealOptionSelection();
  const dateTone = day ? scenarioTone.get(day.date) : undefined;
  const { transitIds, mealActivityIds } = day
    ? dayRelevantIds(day)
    : { transitIds: EMPTY_ID_SET, mealActivityIds: EMPTY_ID_SET };
  const dayRouteTones = useStableFilteredMap(routeTones, transitIds);
  const dayMealOptionIndex = useStableFilteredMap(mealOptionIndex, mealActivityIds);
  // Stable across renders as long as day/dateTone/dayRouteTones/
  // dayMealOptionIndex don't actually change — callers (DayMapSidebar's
  // dayMapRouteNodes/stops useMemos, DayTravelChip's segment-list useMemo)
  // key off this object's identity, which a fresh literal every render
  // would defeat.
  return useMemo(
    () => ({
      scenarioTone: dateTone,
      routeTones: dayRouteTones,
      mealPlaces: day ? collectMealPlaces(day, dayMealOptionIndex) : undefined,
    }),
    [day, dateTone, dayRouteTones, dayMealOptionIndex],
  );
}
