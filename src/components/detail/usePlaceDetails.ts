import { hasGoogleApiKey } from '../../config/apiKeys';
import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getPlace, type PlaceDetails } from '../../model/places';

interface PlaceDetailsState {
  details: PlaceDetails | null;
  loading: boolean;
  failed: boolean;
  configured: boolean;
}

// Only a Place with a real Google Place id gets a live lookup — a
// named-but-unresolved place (place.id: null, e.g. a shipboard restaurant
// with no static geolocation) has nothing to fetch, so callers see
// `loading: false` straight away rather than a state that can only ever
// resolve to "unavailable."
export function usePlaceDetails(placeId: string | null): PlaceDetailsState {
  const configured = hasGoogleApiKey();
  const shouldFetch = Boolean(placeId) && configured;
  const { value: details, loading, failed } = useKeyedAsync(placeId, shouldFetch, getPlace);
  return { details, loading, failed, configured };
}
