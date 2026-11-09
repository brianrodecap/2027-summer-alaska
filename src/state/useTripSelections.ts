import { useRequiredContext } from './contextHook';
import {
  FilterSelectionContext,
  type FilterSelectionValue,
  MealOptionSelectionContext,
  type MealOptionSelectionValue,
  RouteVariantSelectionContext,
  type RouteVariantSelectionValue,
  RowSelectionContext,
  type RowSelectionValue,
  ScenarioSelectionContext,
  type ScenarioSelectionValue,
} from './TripSelectionsContextObject';

function useRequired<T>(context: React.Context<T | null>, name: string): T {
  return useRequiredContext(context, `${name} must be used within a TripSelectionsProvider`);
}

export function useScenarioSelection(): ScenarioSelectionValue {
  return useRequired(ScenarioSelectionContext, 'useScenarioSelection');
}

export function useRouteVariantSelection(): RouteVariantSelectionValue {
  return useRequired(RouteVariantSelectionContext, 'useRouteVariantSelection');
}

export function useMealOptionSelection(): MealOptionSelectionValue {
  return useRequired(MealOptionSelectionContext, 'useMealOptionSelection');
}

export function useFilterSelection(): FilterSelectionValue {
  return useRequired(FilterSelectionContext, 'useFilterSelection');
}

export function useRowSelection(): RowSelectionValue {
  return useRequired(RowSelectionContext, 'useRowSelection');
}
