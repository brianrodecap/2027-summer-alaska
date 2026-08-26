import { useRequiredContext } from './contextHook';
import { TripDataContext, type TripDataContextValue } from './TripDataContextObject';

export function useTripData(): TripDataContextValue {
  return useRequiredContext(TripDataContext, 'useTripData must be used within a TripDataProvider');
}
