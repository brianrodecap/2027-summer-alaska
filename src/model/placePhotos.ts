// Google Places photos, resolved live. A stored photo is only a PlacePhotoRef
// (see types.ts): Google's photo names expire and its terms forbid storing
// them, so every render looks the names up fresh and builds the media URL from
// one. The lookup asks for the `photos` field alone, which Google bills as
// Place Details Essentials (IDs Only), and each place is looked up at most
// once per page load — the media fetch itself (one plain <img src> per photo
// shown) is the only per-image cost. A lookup that fails stays failed for the
// page load: each row naming that place would otherwise retry it on mount.
import { getGoogleApiKey } from '../config/apiKeys';
import {
  fetchPlaceFields,
  isPlacesApiKeyConfigured,
  placeAlreadyRequested,
  type PlacePhoto,
} from './places';
import type { Image, Place, PlacePhotoRef } from './types';

// Google returns up to 10 photos per place — capped well below that so one
// lookup can never queue up more lazy-loaded media fetches than a thumbnail
// strip could ever show at once. Exported so PlacePanel's own thumbnail
// strip renders exactly this many, never more.
export const MAX_PHOTOS = 4;

// Each media fetch is billed, so a row's avatar and its side sheet's hero share
// one size — the same URL, downloaded once — rather than each fetching its own.
// Only PlacePanel's strip of other photos (120x90 shown) asks for a smaller one.
const PHOTO_SIZE_PX = { thumbnail: 240, photo: 400 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZE_PX;

// Photo Media is fetched directly by the browser as a plain <img src> —
// never through googleApiFetch's header-based auth, since an <img> can't
// attach a custom header. Google's media endpoint takes the key as a query
// param for exactly this.
export function photoMediaUrl(photoName: string, size: PhotoSize): string {
  const px = String(PHOTO_SIZE_PX[size]);
  const params = new URLSearchParams({ maxWidthPx: px, maxHeightPx: px, key: getGoogleApiKey() });
  return `https://places.googleapis.com/v1/${photoName}/media?${params}`;
}

// The image a place shows by default: its primary photo, whichever that is
// when it's drawn.
export function placePrimaryImage(placeId: string): Image {
  return { placePhoto: { placeId }, credit: null, caption: null };
}

// A resolved place with no image yet, given its primary photo; any other place
// as is (the same object, so a pass over unchanged places stays cheap).
export function withPrimaryImage<P extends Place | null | undefined>(place: P): P {
  return place?.id && !place.images?.length
    ? { ...place, images: [placePrimaryImage(place.id)] }
    : place;
}

// A place just picked from a search, with its primary photo — a new place
// carries no images from whatever was picked before it.
export function pickedPlace({ id, label }: { id: string; label: string }): Place {
  return { id, label, images: [placePrimaryImage(id)] };
}

const authorOf = (photo: PlacePhoto) => photo.authorAttributions?.[0]?.displayName;

// The photos among `photos` that a ref's author and size describe — a field
// the ref doesn't have doesn't narrow.
function described(photos: PlacePhoto[], ref: Omit<PlacePhotoRef, 'placeId'>): PlacePhoto[] {
  return photos.filter(
    (p) =>
      (!ref.author || authorOf(p) === ref.author) &&
      (!ref.widthPx || p.widthPx === ref.widthPx) &&
      (!ref.heightPx || p.heightPx === ref.heightPx),
  );
}

// One particular photo a viewer picked from `photos` (the place's photos as
// listed), kept by what identifies it across lookups: its author and size,
// plus which one it was when several share both.
export function placePhotoImage(placeId: string, photo: PlacePhoto, photos: PlacePhoto[]): Image {
  const author = authorOf(photo);
  const ref = {
    ...(author ? { author } : {}),
    ...(photo.widthPx ? { widthPx: photo.widthPx } : {}),
    ...(photo.heightPx ? { heightPx: photo.heightPx } : {}),
  };
  const nth = described(photos, ref).indexOf(photo);
  return {
    placePhoto: { placeId, ...ref, ...(nth > 0 ? { nth } : {}) },
    credit: null,
    caption: null,
  };
}

// The photo a ref names among the place's current ones: the one its author and
// size describe (the nth, when several do), else the same author's, else the
// primary photo — Google can drop or reorder a place's photos, and a picked one
// that's gone falls back to a photo of the same place rather than none.
export function matchPlacePhoto(photos: PlacePhoto[], ref: PlacePhotoRef): PlacePhoto | null {
  const exact = described(photos, ref);
  const sameAuthor = ref.author ? photos.filter((p) => authorOf(p) === ref.author) : [];
  return exact[ref.nth ?? 0] ?? exact[0] ?? sameAuthor[0] ?? photos[0] ?? null;
}

// Per place id: its lookup, and its photos once that settles (an empty list
// for a failed lookup) — read synchronously, so a row that re-mounts (or a
// second row naming the same place) draws its photo on the first render.
interface Lookup {
  promise: Promise<void>;
  photos?: PlacePhoto[];
  failedAt?: number;
}
const lookups = new Map<string, Lookup>();

// How long a failed lookup stands before the next image naming that place
// tries again — long enough that the rows mounting together after one failure
// don't each retry it, short enough that a network blip doesn't blank the
// place's photos until a reload.
const RETRY_AFTER_MS = 30_000;

// Looks up a place's current photos once per page load (again only after a
// failure, see RETRY_AFTER_MS) — from a full lookup when one was started,
// else on their own. A first lookup decides a microtask later: a side sheet's
// hero image mounts before its PlacePanel, so the hero's effect asks first
// and the panel's full lookup starts later in the same commit. Waiting until
// that commit's effects have all run lets the hero read the panel's lookup
// instead of paying for a second, photos-only one. It saves nothing when the
// photos-only lookup came first (a day row's avatar, before its sheet opened):
// the panel's full lookup asks for more than photos and still goes out.
function lookUpPhotos(placeId: string): Promise<void> {
  const known = lookups.get(placeId);
  const retry = known?.failedAt !== undefined && Date.now() - known.failedAt > RETRY_AFTER_MS;
  if (known && !retry) return known.promise;
  const photosOnly = () => fetchPlaceFields<{ photos?: PlacePhoto[] }>(placeId, 'photos');
  // A full lookup that failed (getPlace keeps its rejection for the page
  // load) is no reason to go without photos: they're asked for on their own.
  const lookup = retry
    ? photosOnly()
    : Promise.resolve().then(
        () => placeAlreadyRequested(placeId)?.catch(photosOnly) ?? photosOnly(),
      );
  const entry: Lookup = {
    promise: lookup
      .then((details) => {
        entry.photos = details.photos ?? [];
      })
      .catch(() => {
        entry.photos = [];
        entry.failedAt = Date.now();
      }),
  };
  lookups.set(placeId, entry);
  return entry.promise;
}

export interface ResolvedImage {
  src: string;
  credit: string | null;
}

// The image as it can be drawn right now: a web image as is, a place photo
// once its place's photos are known (null when it has none, undefined while
// they aren't known yet).
export function peekImage(
  image: Image,
  size: PhotoSize = 'photo',
): ResolvedImage | null | undefined {
  if ('uri' in image) return { src: image.uri, credit: image.credit };
  const photos = lookups.get(image.placePhoto.placeId)?.photos;
  if (!photos) return undefined;
  const photo = matchPlacePhoto(photos, image.placePhoto);
  return photo
    ? {
        src: photoMediaUrl(photo.name, size),
        credit: photo.authorAttributions?.[0]?.displayName ?? null,
      }
    : null;
}

// The image's src and credit, looking up its place's photos if need be. Null
// when there's nothing to draw: no key, a failed lookup, or no photos.
export async function resolveImage(
  image: Image,
  size: PhotoSize = 'photo',
): Promise<ResolvedImage | null> {
  if ('placePhoto' in image) {
    if (!isPlacesApiKeyConfigured()) return null;
    await lookUpPhotos(image.placePhoto.placeId);
  }
  return peekImage(image, size) ?? null;
}
