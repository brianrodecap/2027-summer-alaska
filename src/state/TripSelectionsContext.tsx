import { type ReactNode, useMemo, useState } from 'react';

import {
  type ActivitySelection,
  ActivitySelectionContext,
  type ActivitySelectionValue,
  FilterSelectionContext,
  type FilterSelectionValue,
  MealOptionSelectionContext,
  type MealOptionSelectionValue,
  RouteToneSelectionContext,
  type RouteToneSelectionValue,
  ScenarioSelectionContext,
  type ScenarioSelectionValue,
} from './TripSelectionsContextObject';

// Replaces the old vanilla-JS app's "read live tab state off the DOM" pattern
// (readDaySelections/recomputeRoutedTransits) with real React state. Every
// place trip-model.ts accepts a `live`/`selections` argument
// (resolveTransitRoute, dayMapStops, dayFullRouteUrls) derives it from these
// contexts via a small selector, instead of querying rendered DOM nodes.

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function TripSelectionsProvider({ children }: { children: ReactNode }) {
  const [scenarioTone, setScenarioTone] = useState<Map<string, string>>(new Map());
  const [routeTones, setRouteTones] = useState<Map<string, string>>(new Map());
  const [mealOptionIndex, setMealOptionIndex] = useState<Map<string, number>>(new Map());
  const [activeFilterTokens, setActiveFilterTokens] = useState<Set<string>>(new Set());
  const [activitySelection, setActivitySelection] = useState<ActivitySelection | null>(null);

  const scenarioValue = useMemo<ScenarioSelectionValue>(
    () => ({
      scenarioTone,
      selectScenario: (date, tone) => setScenarioTone((prev) => new Map(prev).set(date, tone)),
    }),
    [scenarioTone],
  );

  const routeToneValue = useMemo<RouteToneSelectionValue>(
    () => ({
      routeTones,
      selectRouteTone: (transitId, tone) =>
        setRouteTones((prev) => new Map(prev).set(transitId, tone)),
    }),
    [routeTones],
  );

  const mealOptionValue = useMemo<MealOptionSelectionValue>(
    () => ({
      mealOptionIndex,
      selectMealOption: (activityId, index) =>
        setMealOptionIndex((prev) => new Map(prev).set(activityId, index)),
    }),
    [mealOptionIndex],
  );

  const filterValue = useMemo<FilterSelectionValue>(
    () => ({
      activeFilterTokens,
      toggleFilterToken: (token) => setActiveFilterTokens((prev) => toggleInSet(prev, token)),
      clearFilterTokens: () => setActiveFilterTokens(new Set()),
    }),
    [activeFilterTokens],
  );

  // A click on a handle in a different container replaces the selection
  // outright with just that one activity, rather than merging into it — see
  // ActivitySelectionValue's own note on why selection never spans two
  // containers at once.
  const activitySelectionValue = useMemo<ActivitySelectionValue>(
    () => ({
      selection: activitySelection,
      toggleActivitySelection: (containerId, activityId) =>
        setActivitySelection((prev) => {
          if (!prev || prev.containerId !== containerId) {
            return { containerId, ids: new Set([activityId]) };
          }
          const ids = toggleInSet(prev.ids, activityId);
          return ids.size ? { containerId, ids } : null;
        }),
      clearActivitySelection: () => setActivitySelection(null),
    }),
    [activitySelection],
  );

  return (
    <ScenarioSelectionContext.Provider value={scenarioValue}>
      <RouteToneSelectionContext.Provider value={routeToneValue}>
        <MealOptionSelectionContext.Provider value={mealOptionValue}>
          <FilterSelectionContext.Provider value={filterValue}>
            <ActivitySelectionContext.Provider value={activitySelectionValue}>
              {children}
            </ActivitySelectionContext.Provider>
          </FilterSelectionContext.Provider>
        </MealOptionSelectionContext.Provider>
      </RouteToneSelectionContext.Provider>
    </ScenarioSelectionContext.Provider>
  );
}
