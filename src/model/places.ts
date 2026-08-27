// Live place lookups via the Places API (New) Place Details endpoint — each
// activity that names a real-world place carries a pinned Google Place ID
// (place = { id, label }, resolved once by hand rather than re-searched by
// text on every visit), so the trip data stays free of duplicated
// hours/website/etc. Fetching by ID instead of Text Search is both cheaper
// (Place Details Enterprise: $20/1k calls vs. Text Search Enterprise: $35/1k)
// and exact — a free-text search can silently match the wrong business (this
// project's own migration caught a Talkeetna museum query resolving to an
// unrelated museum in Texas). Deliberately scoped to Enterprise-tier fields
// (hours, website, maps link) and nothing pricier (no photos, no
// rating/reviews — those are Enterprise+Atmosphere and add review
// display/attribution obligations on top of the extra cost).
import { PLACES_API_KEY } from '../config/places';

export interface PlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
}

export interface PlaceDetails {
  formattedAddress?: string;
  regularOpeningHours?: PlaceOpeningHours;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
}

export interface PlaceSearchResult {
  id: string;
  label: string;
  address: string;
}

// No "places." prefix here (unlike Text Search) — Place Details returns a
// single Place object, not a list.
const FIELD_MASK = [
  'formattedAddress',
  'regularOpeningHours',
  'websiteUri',
  'googleMapsUri',
  'primaryType',
].join(',');

// Keyed by place id, caching the in-flight/resolved promise so the same place
// is never fetched twice in one page session (activities can repeat across
// scenario branches, e.g. the same breakfast spot on the ideal and alternate plan).
const cache = new Map<string, Promise<PlaceDetails>>();

// Raw Place Details fetch for a given field mask — shared with weather.ts's
// coordinate lookup below, which needs the same endpoint/auth/error-handling
// but a different (cheaper) field mask than this module's own FIELD_MASK.
export async function fetchPlaceFields<T>(id: string, fieldMask: string): Promise<T> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    headers: {
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
  });
  if (!res.ok) throw new Error(`Places API error ${res.status}`);
  return res.json();
}

export async function fetchPlace(id: string): Promise<PlaceDetails> {
  return fetchPlaceFields<PlaceDetails>(id, FIELD_MASK);
}

export function getPlace(id: string): Promise<PlaceDetails> {
  if (!cache.has(id)) cache.set(id, fetchPlace(id));
  return cache.get(id) as Promise<PlaceDetails>;
}

// Free-text search — the Places API (New) Text Search endpoint, used only by
// the editor's place picker (PlacePickerField's usePlaceSearch hook) to find
// a Place ID when a name is known but the id isn't. Deliberately separate
// from fetchPlace/getPlace above: Text Search is pricier per call
// (Enterprise: $35/1k vs. Place Details Enterprise's $20/1k, per the file-top
// note) and returns a list of candidates rather than one exact place, which
// is fine for an occasional editing action but wrong for the per-visitor
// Place Details hydration every activity's side sheet already runs on every
// page load — this never runs outside the edit dialog, so it never touches
// that per-visitor cost.
const SEARCH_FIELD_MASK = ['places.id', 'places.displayName', 'places.formattedAddress'].join(',');

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
  });
  if (!res.ok) throw new Error(`Places API error ${res.status}`);
  const { places } = await res.json();
  return (places ?? []).map(
    (p: {
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
    }): PlaceSearchResult => ({
      id: p.id,
      label: p.displayName?.text ?? '',
      address: p.formattedAddress ?? '',
    }),
  );
}

export function isPlacesApiKeyConfigured(): boolean {
  return Boolean(PLACES_API_KEY) && !PLACES_API_KEY.startsWith('REPLACE_');
}
