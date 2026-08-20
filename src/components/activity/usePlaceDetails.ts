import { useEffect, useState } from 'react';

import { getPlace, isPlacesApiKeyConfigured, type PlaceDetails } from '../../model/places';

interface PlaceDetailsState {
  details: PlaceDetails | null;
  loading: boolean;
  failed: boolean;
  configured: boolean;
}

// Only a Place with a real Google Place id gets a live lookup — a
// named-but-unresolved place (place.id: null, e.g. a shipboard restaurant
// with no static geolocation) has nothing to fetch, so the caller should
// skip straight past this hook rather than show a loading state that can
// only ever resolve to "unavailable."
export function usePlaceDetails(placeId: string | null): PlaceDetailsState {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(placeId));
  const [failed, setFailed] = useState(false);
  const configured = isPlacesApiKeyConfigured();

  useEffect(() => {
    if (!placeId || !configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getPlace(placeId)
      .then((result) => {
        if (cancelled) return;
        setDetails(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placeId, configured]);

  return { details, loading, failed, configured };
}
