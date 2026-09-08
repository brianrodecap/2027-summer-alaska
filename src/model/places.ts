// Live place lookups via the Places API (New) Place Details endpoint — each
// activity that names a real-world place carries a pinned Google Place ID
// (place = { id, label }, resolved once by hand rather than re-searched by
// text on every visit), so the trip data stays free of duplicated
// hours/website/etc. Fetching by ID instead of Text Search is both cheaper
// (Place Details Enterprise: $20/1k calls vs. Text Search Enterprise: $35/1k)
// and exact — a free-text search can silently match the wrong business (this
// project's own migration caught a Talkeetna museum query resolving to an
// unrelated museum in Texas). Scoped to Enterprise-tier fields (hours,
// website, maps link) plus the separate, cheaper Photos SKU (~$7/1k on top,
// billed only for the `photos` field itself — see PlacePanel for the actual
// photo media fetch, a second, unauthenticated-by-us request the browser
// makes directly) — still nothing from Enterprise+Atmosphere (no
// rating/reviews, which add review display/attribution obligations on top of
// the extra cost).
import { PLACES_API_KEY } from '../config/places';
import { googleApiFetch } from './googleApiFetch';
import type { Image } from './types';

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
  'photos',
].join(',');

// Google returns up to 10 photos per place — capped well below that so one
// lookup can never queue up more lazy-loaded media fetches than a thumbnail
// strip could ever show at once. Exported so PlacePanel's own thumbnail
// strip renders exactly this many, never more.
export const MAX_PHOTOS = 4;

// Two distinct sizes for two distinct jobs, never the same URL for both —
// requesting the hero's own 400px size for every one of MAX_PHOTOS thumbnail
// previews (each displayed at only ~120x90) was pulling down several times
// the pixel data any of them actually needed, on every single lookup.
// Thumbnails stay small; only the one photo an entity actually stores as its
// hero (see formatting.ts's withHeroImage) is ever fetched at the larger size.
const PHOTO_THUMBNAIL_DIMENSION_PX = 240;
const PHOTO_HERO_DIMENSION_PX = 400;

// Photo Media is fetched directly by the browser as a plain <img src> (see
// PlacePanel's loading="lazy" thumbnails) — never through googleApiFetch's
// header-based auth, since a hotlinked <img> can't attach a custom header.
// Google's media endpoint is built for exactly this, taking the key as a
// query param instead.
function photoMediaUrl(photoName: string, dimensionPx: number): string {
  const params = new URLSearchParams({
    maxWidthPx: String(dimensionPx),
    maxHeightPx: String(dimensionPx),
    key: PLACES_API_KEY,
  });
  return `https://places.googleapis.com/v1/${photoName}/media?${params}`;
}

// The small size PlacePanel's own thumbnail strip previews at — never
// persisted, since these are shown live and re-fetched fresh every time the
// strip renders (see PlacePanel).
export function photoThumbnailUrl(photoName: string): string {
  return photoMediaUrl(photoName, PHOTO_THUMBNAIL_DIMENSION_PX);
}

// The Image[] shape every entity's own top-level `images` stores (see
// formatting.ts's withHeroImage) — built only for whichever single photo a
// viewer actually clicks in the strip, at the larger hero-appropriate size,
// so nothing this size is ever fetched for a photo nobody picked.
export function placeImageFromPhoto(photo: PlacePhoto): Image {
  return {
    uri: photoMediaUrl(photo.name, PHOTO_HERO_DIMENSION_PX),
    credit: photo.authorAttributions?.[0]?.displayName ?? null,
    caption: null,
  };
}

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
  const { places } = await googleApiFetch<{
    places?: { id: string; displayName?: { text?: string }; formattedAddress?: string }[];
  }>('Places API', 'https://places.googleapis.com/v1/places:searchText', SEARCH_FIELD_MASK, {
    textQuery: query,
    maxResultCount: 5,
  });
  return (places ?? []).map((p): PlaceSearchResult => ({
    id: p.id,
    label: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
  }));
}

export function isPlacesApiKeyConfigured(): boolean {
  return Boolean(PLACES_API_KEY) && !PLACES_API_KEY.startsWith('REPLACE_');
}
