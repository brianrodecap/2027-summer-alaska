import { type ReactNode, useCallback, useMemo, useState } from 'react';

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

// The scenario/route-tone/meal-option selections below all keep the same
// shape of state — a Map from some entity id to the tab currently picked for
// it — differing only in the key/value types, so they share this one hook
// rather than each hand-rolling its own useState + immutable-set updater.
function useMapSlot<K, V>(): [Map<K, V>, (key: K, value: V) => void] {
  const [map, setMap] = useState<Map<K, V>>(() => new Map());
  const set = useCallback((key: K, value: V) => {
    setMap((prev) => new Map(prev).set(key, value));
  }, []);
  return [map, set];
}

export function TripSelectionsProvider({ children }: { children: ReactNode }) {
  const [scenarioTone, setScenarioTone] = useMapSlot<string, string>();
  const [routeTones, setRouteTones] = useMapSlot<string, string>();
  const [mealOptionIndex, setMealOptionIndex] = useMapSlot<string, number>();
  const [activeFilterTokens, setActiveFilterTokens] = useState<Set<string>>(new Set());
  const [rowSelection, setRowSelection] = useState<RowSelection | null>(null);

  const scenarioValue = useMemo<ScenarioSelectionValue>(
    () => ({ scenarioTone, selectScenario: setScenarioTone }),
    [scenarioTone, setScenarioTone],
  );

  const routeToneValue = useMemo<RouteToneSelectionValue>(
    () => ({ routeTones, selectRouteTone: setRouteTones }),
    [routeTones, setRouteTones],
  );

  const mealOptionValue = useMemo<MealOptionSelectionValue>(
    () => ({ mealOptionIndex, selectMealOption: setMealOptionIndex }),
    [mealOptionIndex, setMealOptionIndex],
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
