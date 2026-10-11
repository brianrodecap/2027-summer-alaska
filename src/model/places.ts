// Live place lookups via the Places API (New) Place Details endpoint — each
// activity that names a real-world place carries a pinned Google Place ID
// (place = { id, label }, resolved once by hand rather than re-searched by
// text on every visit), so the trip data stays free of duplicated
// hours/website/etc. Fetching by ID instead of Text Search is both cheaper
// (Place Details Enterprise: $20/1k calls vs. Text Search Enterprise: $35/1k)
// and exact — a free-text search can silently match the wrong business (this
// project's own migration caught a Talkeetna museum query resolving to an
// unrelated museum in Texas). Scoped to Enterprise-tier fields (hours,
// website, maps link) plus `photos` (photo metadata, which on its own is the
// Essentials IDs Only SKU — see placePhotos.ts, which asks for nothing else
// and fetches the photo media itself, the separately billed request, as a
// plain <img src>) — still nothing from Enterprise+Atmosphere (no
// rating/reviews, which add review display/attribution obligations on top of
// the extra cost).
import { getGoogleApiKey } from '../config/apiKeys';
import { memoizeAsync } from './asyncCache';
import { googleApiFetch } from './googleApiFetch';

export interface PlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
}

export interface PlaceAuthorAttribution {
  displayName: string;
  uri?: string;
}

export interface PlacePhoto {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: PlaceAuthorAttribution[];
}

export interface PlaceDetails {
  formattedAddress?: string;
  regularOpeningHours?: PlaceOpeningHours;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
  photos?: PlacePhoto[];
  phone?: string;
}

// The wire shape the Places API (New) actually returns — same fields, but
// under Google's own `nationalPhoneNumber` name (the literal field mask
// value it expects, see FIELD_MASK below) rather than our simpler `phone`.
type RawPlaceDetails = Omit<PlaceDetails, 'phone'> & { nationalPhoneNumber?: string };

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
  'photos',
  'nationalPhoneNumber',
].join(',');

// Keyed by place id, caching the in-flight/resolved promise so the same place
// is never fetched twice in one page session (activities can repeat across
// scenario branches, e.g. the same breakfast spot on the ideal and alternate plan).
const cache = new Map<string, Promise<PlaceDetails>>();

// Raw Place Details fetch for a given field mask — shared with weather.ts's
// coordinate lookup below, which needs the same endpoint/auth/error-handling
// but a different (cheaper) field mask than this module's own FIELD_MASK.
export async function fetchPlaceFields<T>(id: string, fieldMask: string): Promise<T> {
  return googleApiFetch<T>(
    'Places API',
    `https://places.googleapis.com/v1/places/${id}`,
    fieldMask,
  );
}

export async function fetchPlace(id: string): Promise<PlaceDetails> {
  const { nationalPhoneNumber, ...rest } = await fetchPlaceFields<RawPlaceDetails>(id, FIELD_MASK);
  return { ...rest, phone: nationalPhoneNumber };
}

export function getPlace(id: string): Promise<PlaceDetails> {
  return memoizeAsync(cache, id, () => fetchPlace(id));
}

// The full lookup for `id` if this page load has already started one — so a
// photo lookup (placePhotos.ts) for a place whose side sheet is open reads its
// photos from there instead of asking Google a second time.
export function placeAlreadyRequested(id: string): Promise<PlaceDetails> | undefined {
  return cache.get(id);
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

// `includedType` restricts results to one Places type (e.g. 'airport'), strictly
// — without it a query like "Kotzebue (OTZ)" can rank any business whose name
// happens to contain the code above the airport itself.
// Memoized per page load on query + type: a document import resolves every
// entry's places at once, and a round trip names each airport twice — each
// repeat would otherwise be another billed Text Search. A failed search is
// dropped from the cache so a retry can succeed.
const searchCache = new Map<string, Promise<PlaceSearchResult[]>>();

export function searchPlaces(query: string, includedType?: string): Promise<PlaceSearchResult[]> {
  const key = `${includedType ?? ''}\0${query}`;
  const result = memoizeAsync(searchCache, key, () => fetchSearch(query, includedType));
  result.catch(() => searchCache.delete(key));
  return result;
}

async function fetchSearch(query: string, includedType?: string): Promise<PlaceSearchResult[]> {
  const { places } = await googleApiFetch<{
    places?: { id: string; displayName?: { text?: string }; formattedAddress?: string }[];
  }>('Places API', 'https://places.googleapis.com/v1/places:searchText', SEARCH_FIELD_MASK, {
    textQuery: query,
    maxResultCount: 5,
    ...(includedType ? { includedType, strictTypeFiltering: true } : {}),
  });
  return (places ?? []).map((p): PlaceSearchResult => ({
    id: p.id,
    label: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
  }));
}

export function isPlacesApiKeyConfigured(): boolean {
  return Boolean(getGoogleApiKey());
}
