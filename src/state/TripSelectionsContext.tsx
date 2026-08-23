import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

// Replaces the old vanilla-JS app's "read live tab state off the DOM" pattern
// (readDaySelections/recomputeRoutedTransits) with real React state. Every
// place trip-model.ts accepts a `live`/`selections` argument
// (resolveTransitRoute, dayMapStops, dayFullRouteUrls) derives it from these
// contexts via a small selector, instead of querying rendered DOM nodes.
//
// Four independent contexts rather than one combined value: with a single
// context, picking a meal option anywhere recreates one shared value object,
// which re-renders every consumer of *any* selection everywhere in the
// (unvirtualized, ~28-day) list — including DayTimeline's own top-level
// activeFilterTokens read, which forces every day to rebuild its whole node
// list. Splitting by concern means a route-tone pick only re-renders the
// handful of components that actually read route tones.

interface ScenarioSelectionValue {
  scenarioTone: Map<string, string>; // date -> tone
  selectScenario: (date: string, tone: string) => void;
}

interface RouteToneSelectionValue {
  routeTones: Map<string, string>; // transitId -> tone
  selectRouteTone: (transitId: string, tone: string) => void;
}

interface MealOptionSelectionValue {
  mealOptionIndex: Map<string, number>; // activityId -> chosen option index
  selectMealOption: (activityId: string, index: number) => void;
}

interface FilterSelectionValue {
  activeFilterTokens: Set<string>; // the day list's own filter-nav selection
  toggleFilterToken: (token: string) => void;
  clearFilterTokens: () => void;
}

const ScenarioSelectionContext = createContext<ScenarioSelectionValue | null>(null);
const RouteToneSelectionContext = createContext<RouteToneSelectionValue | null>(null);
const MealOptionSelectionContext = createContext<MealOptionSelectionValue | null>(null);
const FilterSelectionContext = createContext<FilterSelectionValue | null>(null);

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

function useRequiredContext<T>(context: React.Context<T | null>, name: string): T {
  const ctx = useContext(context);
  if (!ctx) throw new Error(`${name} must be used within a TripSelectionsProvider`);
  return ctx;
}

export function useScenarioSelection(): ScenarioSelectionValue {
  return useRequiredContext(ScenarioSelectionContext, 'useScenarioSelection');
}

export function useRouteToneSelection(): RouteToneSelectionValue {
  return useRequiredContext(RouteToneSelectionContext, 'useRouteToneSelection');
}

export function useMealOptionSelection(): MealOptionSelectionValue {
  return useRequiredContext(MealOptionSelectionContext, 'useMealOptionSelection');
}

export function useFilterSelection(): FilterSelectionValue {
  return useRequiredContext(FilterSelectionContext, 'useFilterSelection');
}
