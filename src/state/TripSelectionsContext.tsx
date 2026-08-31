import { type ReactNode, useMemo, useState } from 'react';

import {
  FilterSelectionContext,
  type FilterSelectionValue,
  MealOptionSelectionContext,
  type MealOptionSelectionValue,
  RouteToneSelectionContext,
  type RouteToneSelectionValue,
  type RowSelection,
  RowSelectionContext,
  type RowSelectionValue,
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
  const [rowSelection, setRowSelection] = useState<RowSelection | null>(null);

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

  // A click on a handle in a different container adds that row to the
  // existing selection (recording this container as its own origin) rather
  // than resetting it — see RowSelection's own note in
  // TripSelectionsContextObject.ts on why a selection can span several
  // containers.
  const rowSelectionValue = useMemo<RowSelectionValue>(
    () => ({
      selection: rowSelection,
      toggleRowSelection: (dragId, containerId, members) =>
        setRowSelection((prev) => {
          const rows = new Map(prev?.rows ?? []);
          if (rows.has(dragId)) rows.delete(dragId);
          else rows.set(dragId, { containerId, members });
          return rows.size ? { rows } : null;
        }),
      clearRowSelection: () => setRowSelection(null),
    }),
    [rowSelection],
  );

  return (
    <ScenarioSelectionContext.Provider value={scenarioValue}>
      <RouteToneSelectionContext.Provider value={routeToneValue}>
        <MealOptionSelectionContext.Provider value={mealOptionValue}>
          <FilterSelectionContext.Provider value={filterValue}>
            <RowSelectionContext.Provider value={rowSelectionValue}>
              {children}
            </RowSelectionContext.Provider>
          </FilterSelectionContext.Provider>
        </MealOptionSelectionContext.Provider>
      </RouteToneSelectionContext.Provider>
    </ScenarioSelectionContext.Provider>
  );
}
