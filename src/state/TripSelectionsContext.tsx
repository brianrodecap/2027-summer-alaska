import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// Replaces the old vanilla-JS app's "read live tab state off the DOM" pattern
// (readDaySelections/recomputeRoutedTransits) with real React state. Every
// place trip-model.ts accepts a `live`/`selections` argument
// (resolveTransitRoute, dayMapStops, dayFullRouteUrl) derives it from this
// context via a small selector, instead of querying rendered DOM nodes.
interface TripSelectionsValue {
  scenarioTone: Map<string, string>; // date -> tone
  routeTones: Map<string, string>; // transitId -> tone
  mealOptionIndex: Map<string, number>; // activityId -> chosen option index
  activeFilterTokens: Set<string>; // the day list's own filter-nav selection
  selectScenario: (date: string, tone: string) => void;
  selectRouteTone: (transitId: string, tone: string) => void;
  selectMealOption: (activityId: string, index: number) => void;
  toggleFilterToken: (token: string) => void;
  clearFilterTokens: () => void;
}

const TripSelectionsContext = createContext<TripSelectionsValue | null>(null);

export function TripSelectionsProvider({ children }: { children: ReactNode }) {
  const [scenarioTone, setScenarioTone] = useState<Map<string, string>>(new Map());
  const [routeTones, setRouteTones] = useState<Map<string, string>>(new Map());
  const [mealOptionIndex, setMealOptionIndex] = useState<Map<string, number>>(new Map());
  const [activeFilterTokens, setActiveFilterTokens] = useState<Set<string>>(new Set());

  const value = useMemo<TripSelectionsValue>(
    () => ({
      scenarioTone,
      routeTones,
      mealOptionIndex,
      activeFilterTokens,
      selectScenario: (date, tone) => setScenarioTone((prev) => new Map(prev).set(date, tone)),
      selectRouteTone: (transitId, tone) => setRouteTones((prev) => new Map(prev).set(transitId, tone)),
      selectMealOption: (activityId, index) => setMealOptionIndex((prev) => new Map(prev).set(activityId, index)),
      toggleFilterToken: (token) =>
        setActiveFilterTokens((prev) => {
          const next = new Set(prev);
          if (next.has(token)) next.delete(token);
          else next.add(token);
          return next;
        }),
      clearFilterTokens: () => setActiveFilterTokens(new Set()),
    }),
    [scenarioTone, routeTones, mealOptionIndex, activeFilterTokens],
  );

  return <TripSelectionsContext.Provider value={value}>{children}</TripSelectionsContext.Provider>;
}

export function useTripSelections(): TripSelectionsValue {
  const ctx = useContext(TripSelectionsContext);
  if (!ctx) throw new Error('useTripSelections must be used within a TripSelectionsProvider');
  return ctx;
}
