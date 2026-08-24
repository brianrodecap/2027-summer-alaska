import { type ReactNode, useMemo, useState } from 'react';

import {
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

export function TripSelectionsProvider({ children }: { children: ReactNode }) {
  const [scenarioTone, setScenarioTone] = useState<Map<string, string>>(new Map());
  const [routeTones, setRouteTones] = useState<Map<string, string>>(new Map());
  const [mealOptionIndex, setMealOptionIndex] = useState<Map<string, number>>(new Map());
  const [activeFilterTokens, setActiveFilterTokens] = useState<Set<string>>(new Set());

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
      toggleFilterToken: (token) =>
        setActiveFilterTokens((prev) => {
          const next = new Set(prev);
          if (next.has(token)) next.delete(token);
          else next.add(token);
          return next;
        }),
      clearFilterTokens: () => setActiveFilterTokens(new Set()),
    }),
    [activeFilterTokens],
  );

  return (
    <ScenarioSelectionContext.Provider value={scenarioValue}>
      <RouteToneSelectionContext.Provider value={routeToneValue}>
        <MealOptionSelectionContext.Provider value={mealOptionValue}>
          <FilterSelectionContext.Provider value={filterValue}>
            {children}
          </FilterSelectionContext.Provider>
        </MealOptionSelectionContext.Provider>
      </RouteToneSelectionContext.Provider>
    </ScenarioSelectionContext.Provider>
  );
}
