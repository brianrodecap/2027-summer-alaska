import { createContext } from 'react';

// Four independent contexts rather than one combined value: with a single
// context, picking a meal option anywhere recreates one shared value object,
// which re-renders every consumer of *any* selection everywhere in the
// (unvirtualized, ~28-day) list — including DayTimeline's own top-level
// activeFilterTokens read, which forces every day to rebuild its whole node
// list. Splitting by concern means a route-tone pick only re-renders the
// handful of components that actually read route tones.

export interface ScenarioSelectionValue {
  scenarioTone: Map<string, string>; // date -> tone
  selectScenario: (date: string, tone: string) => void;
}

export interface RouteToneSelectionValue {
  routeTones: Map<string, string>; // transitId -> tone
  selectRouteTone: (transitId: string, tone: string) => void;
}

export interface MealOptionSelectionValue {
  mealOptionIndex: Map<string, number>; // activityId -> chosen option index
  selectMealOption: (activityId: string, index: number) => void;
}

export interface FilterSelectionValue {
  activeFilterTokens: Set<string>; // the day list's own filter-nav selection
  toggleFilterToken: (token: string) => void;
  clearFilterTokens: () => void;
}

export const ScenarioSelectionContext = createContext<ScenarioSelectionValue | null>(null);
export const RouteToneSelectionContext = createContext<RouteToneSelectionValue | null>(null);
export const MealOptionSelectionContext = createContext<MealOptionSelectionValue | null>(null);
export const FilterSelectionContext = createContext<FilterSelectionValue | null>(null);
