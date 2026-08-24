import { useContext } from 'react';

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
