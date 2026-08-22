import { useEffect, useState } from 'react';

import { getPlace, isPlacesApiKeyConfigured, type PlaceDetails } from '../../model/places';

interface PlaceDetailsState {
  details: PlaceDetails | null;
  loading: boolean;
  failed: boolean;
  configured: boolean;
}

interface FetchResult {
  placeId: string | null;
  details: PlaceDetails | null;
  failed: boolean;
}

const EMPTY_RESULT: FetchResult = { placeId: null, details: null, failed: false };

// Only a Place with a real Google Place id gets a live lookup — a
// named-but-unresolved place (place.id: null, e.g. a shipboard restaurant
// with no static geolocation) has nothing to fetch, so callers see
// `loading: false` straight away rather than a state that can only ever
// resolve to "unavailable."
//
// `result` is keyed by the placeId it was fetched for, so `loading`/`details`/
// `failed` below are derived by comparing that key to the current `placeId`
// at render time — the effect itself only ever calls setState from its async
// `getPlace` callbacks, never synchronously in the effect body.
export function usePlaceDetails(placeId: string | null): PlaceDetailsState {
  const [result, setResult] = useState<FetchResult>(EMPTY_RESULT);
  const configured = isPlacesApiKeyConfigured();
  const shouldFetch = Boolean(placeId) && configured;

  useEffect(() => {
    if (!shouldFetch || !placeId) return;
    let cancelled = false;
    getPlace(placeId)
      .then((details) => {
        if (!cancelled) setResult({ placeId, details, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ placeId, details: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [placeId, shouldFetch]);

  const loading = shouldFetch && result.placeId !== placeId;
  const details = result.placeId === placeId ? result.details : null;
  const failed = result.placeId === placeId && result.failed;

  return { details, loading, failed, configured };
}
