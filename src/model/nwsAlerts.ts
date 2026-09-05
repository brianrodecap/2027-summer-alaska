// Live National Weather Service alerts (watches/warnings/advisories) for a
// Place, resolved at render time the same way weather.ts resolves live
// forecasts — via the Place's already-cached coordinates (placeCoordinates.ts)
// — and, like weather.ts's own forecast, deliberately never written back into
// the trip's own JSON: this is only ever as of whenever the site happens to
// be open, so it's fetched fresh every visit rather than baked into the data.
//
// NWS's alerts/active endpoint only ever answers "what's active right now"
// (including a watch/advisory issued ahead of an event that hasn't started
// yet) — there's no forecast-alerts endpoint for a future date the way
// Open-Meteo has a forecast window. That's exactly the shape this feature
// wants, though: callers only ever ask for alerts on the real-world today/
// tomorrow (see useDayAlerts), never on some arbitrary future trip date,
// since "is there a watch/warning out" only means something for a day that's
// either happening now or about to.
import { memoizeAsync } from './asyncCache';
import { type Coordinates, getCoordinates } from './placeCoordinates';

export type NwsSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface NwsAlert {
  id: string;
  event: string;
  headline: string | null;
  severity: NwsSeverity;
  areaDesc: string;
  description: string;
  instruction: string | null;
  effective: string; // ISO timestamp, real offset included (not UTC-normalized like trip dates)
  expires: string; // ISO timestamp
}

interface NwsAlertFeature {
  id: string;
  properties: {
    event: string;
    headline: string | null;
    severity: NwsSeverity;
    areaDesc: string;
    description: string | null;
    instruction: string | null;
    effective: string;
    expires: string;
  };
}

interface NwsAlertsResponse {
  features: NwsAlertFeature[];
}

// Kept in-memory only, not persisted to localStorage the way weather.ts's
// climate averages are — an active alert can be issued or cancelled at any
// moment, so a cache that survives a page reload risks showing a stale
// warning as still-active. Rounding the point to 2 decimals (~0.7 mile) still
// dedupes the common case (several Day fields resolving to the same place)
// without pretending to more precision than a county-sized alert zone needs.
const alertsCache = new Map<string, Promise<NwsAlert[]>>();

async function fetchAlertsForCoordinates({ lat, lng }: Coordinates): Promise<NwsAlert[]> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  return memoizeAsync(alertsCache, key, async () => {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`;
    const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as NwsAlertsResponse | null;
    return (json?.features ?? []).map((f) => ({
      id: f.id,
      event: f.properties.event,
      headline: f.properties.headline,
      severity: f.properties.severity,
      areaDesc: f.properties.areaDesc,
      description: f.properties.description ?? '',
      instruction: f.properties.instruction,
      effective: f.properties.effective,
      expires: f.properties.expires,
    }));
  });
}

// Best-effort per place — one place's coordinate lookup failing (or the NWS
// request itself failing) shouldn't blank out alerts for the day's other
// places, so this swallows its own errors rather than letting Promise.all
// reject the whole batch.
async function getPlaceAlerts(placeId: string): Promise<NwsAlert[]> {
  try {
    const coords = await getCoordinates(placeId);
    return await fetchAlertsForCoordinates(coords);
  } catch {
    return [];
  }
}

// Worse-first — the whole point of surfacing these is to lead with whichever
// alert most needs a traveler's attention, same reasoning as AQI_BANDS/
// temperatureColor's own worst-first framing elsewhere in the weather UI.
const SEVERITY_RANK: Record<NwsSeverity, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

// Merges every distinct place's active alerts into one worse-first list for
// the day, deduping by NWS's own alert id — the same real-world alert (a
// state-wide winter storm warning, say) commonly covers more than one of a
// day's places at once.
export async function getAlertsForPlaces(placeIds: string[]): Promise<NwsAlert[]> {
  const uniqueIds = [...new Set(placeIds)];
  const perPlace = await Promise.all(uniqueIds.map(getPlaceAlerts));
  const byId = new Map<string, NwsAlert>();
  for (const alert of perPlace.flat()) byId.set(alert.id, alert);
  return [...byId.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
