// Ground elevation for a Place, in feet — for the "show elevation at this
// place" row (see PlaceConditionsLine). Sourced from Open-Meteo rather than
// Google: the classic Google Maps Elevation API sends no
// Access-Control-Allow-Origin header at all (confirmed directly against
// Google's servers), so it can never be called from browser JS the way this
// site's Places API (New) calls can — there's no config fix for that, since
// it's the API's own CORS design, not a key restriction. Open-Meteo's own
// forecast endpoint already returns a top-level `elevation` field (meters)
// alongside whatever daily variables are requested, for free — so this asks
// for the cheapest possible daily variable purely to get that field back,
// through the same request queue/cooldown weather.ts's own Open-Meteo calls
// share (openMeteoClient.ts).
import { memoizeAsync, persisted } from './asyncCache';
import { fetchOpenMeteoJson } from './openMeteoClient';
import { getCoordinates } from './placeCoordinates';

const METERS_PER_FOOT = 0.3048;

const CACHE_VERSION = 'v2';
// A place's ground elevation never changes, so — like placeCoordinates.ts's
// own coordinate cache — this is persisted forever rather than on a timer.
const CACHE_TTL_MS = Infinity;

const cache = new Map<string, Promise<number | null>>();

async function fetchElevationFt(lat: number, lng: number): Promise<number | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max&forecast_days=1`;
  const json = (await fetchOpenMeteoJson(url)) as { elevation?: number } | null;
  const meters = json?.elevation;
  return typeof meters === 'number' ? Math.round(meters / METERS_PER_FOOT) : null;
}

// Cached by place id (not lat/lng), same shape as getCoordinates — a place
// looked up for elevation on several different days only ever resolves it
// once.
export function getElevationFt(placeId: string): Promise<number | null> {
  const storageKey = `place-elevation:${CACHE_VERSION}:${placeId}`;
  return memoizeAsync(cache, placeId, () =>
    persisted(storageKey, CACHE_TTL_MS, async () => {
      const { lat, lng } = await getCoordinates(placeId);
      return fetchElevationFt(lat, lng);
    }),
  );
}
