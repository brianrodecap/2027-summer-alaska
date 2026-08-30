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

// A multi-select of Activity drag handles, scoped to a single rendered
// DayTimeline (containerId) at a time — clicking a handle in a different
// container replaces the selection outright rather than merging into it, so
// a group drag (DaysView.tsx's handleDragStart/handleDragEnd) never has to
// reason about moving activities out of two different containers at once.
export interface ActivitySelection {
  containerId: string;
  ids: Set<string>;
}

export interface ActivitySelectionValue {
  selection: ActivitySelection | null;
  toggleActivitySelection: (containerId: string, activityId: string) => void;
  clearActivitySelection: () => void;
}

// Shared by DayTimeline.tsx (per-row highlight) and DaysView.tsx (deciding
// whether a drag is a group drag) so both read "is this activity part of the
// active selection for this container" the same way.
export function isActivitySelected(
  selection: ActivitySelection | null,
  containerId: unknown,
  activityId: string,
): boolean {
  return (
    selection !== null && selection.containerId === containerId && selection.ids.has(activityId)
  );
}

export const ScenarioSelectionContext = createContext<ScenarioSelectionValue | null>(null);
export const RouteToneSelectionContext = createContext<RouteToneSelectionValue | null>(null);
export const MealOptionSelectionContext = createContext<MealOptionSelectionValue | null>(null);
export const FilterSelectionContext = createContext<FilterSelectionValue | null>(null);
export const ActivitySelectionContext = createContext<ActivitySelectionValue | null>(null);
