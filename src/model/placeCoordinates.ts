// Lat/lng for a Place, resolved once via the Places API and cached forever
// (a place's coordinates never change) — shared by weather.ts (per-place
// forecast/climate lookups) and elevation.ts, both of which otherwise need
// the exact same Places API round-trip for the same place id.
import { memoizeAsync, persisted } from './asyncCache';
import { fetchPlaceFields } from './places';

export interface Coordinates {
  lat: number;
  lng: number;
}

const CACHE_VERSION = 'v1';
// Coordinates never change, so once persisted they're reused forever (well,
// until CACHE_VERSION bumps) rather than expiring on a timer.
const CACHE_TTL_MS = Infinity;

const cache = new Map<string, Promise<Coordinates>>();

async function fetchCoordinates(placeId: string): Promise<Coordinates> {
  const { location } = await fetchPlaceFields<{
    location: { latitude: number; longitude: number };
  }>(placeId, 'location');
  return { lat: location.latitude, lng: location.longitude };
}

// Cached by place id — a Stay spanning several nights (or a Transit's
// endpoint reused day to day) would otherwise re-resolve the same place's
// coordinates on every one of those days. Also persisted to localStorage so
// a repeat visit skips the Places API call entirely rather than just
// deduping within one page load.
export function getCoordinates(placeId: string): Promise<Coordinates> {
  const storageKey = `place-coords:${CACHE_VERSION}:${placeId}`;
  return memoizeAsync(cache, placeId, () =>
    persisted(storageKey, CACHE_TTL_MS, () => fetchCoordinates(placeId)),
  );
}
