import { useContext } from 'react';

import { TripDataContext, type TripDataContextValue } from './TripDataContextObject';

export function useTripData(): TripDataContextValue {
  const ctx = useContext(TripDataContext);
  if (!ctx) throw new Error('useTripData must be used within a TripDataProvider');
  return ctx;
}
