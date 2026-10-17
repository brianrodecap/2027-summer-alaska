import { useMemo } from 'react';

import { travelersById } from '../model/tripModel';
import { useTripData } from './useTripData';

// Trip traveler id → display name, for any view that resolves stored ids
// (fares, seats, packages, a Transit's riders).
export function useTravelerNames(): Map<string, string> {
  const { data } = useTripData();
  return useMemo(() => travelersById(data?.trip.travelers ?? []), [data]);
}
