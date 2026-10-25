// Google Places photos, resolved live. A stored photo is only a PlacePhotoRef
// (see types.ts): Google's photo names expire and its terms forbid storing
// them, so every render looks the names up fresh and builds the media URL from
// one. The lookup asks for the `photos` field alone, which Google bills as
// Place Details Essentials (IDs Only), and each place is looked up once, again
// only after a failure (see createPhotoResolver) — the media fetch itself (one
// plain <img src> per photo shown) is the only per-image cost.
import { getGoogleApiKey } from '../config/apiKeys';
import { imageKey } from './formatting';
import { fetchPlaceFields, placeAlreadyRequested, type PlacePhoto } from './places';
import type { Image, Place, PlacePhotoRef } from './types';

// Google returns up to 10 photos per place — capped well below that so one
// lookup can never queue up more lazy-loaded media fetches than a thumbnail
// strip could ever show at once. Exported so PlacePanel's own thumbnail
// strip renders exactly this many, never more.
export const MAX_PHOTOS = 4;

// Each media fetch is billed per request, whatever its size. A row's avatar
// (48px shown) asks for its own small size: most rows are never opened, so
// downloading a sheet-sized photo for each would cost bandwidth on every row to
// save one request per opened sheet. PlacePanel's strip of other photos (120x90
// shown) asks for `thumbnail`, side sheets and cards for `photo`, and the
// full-width trip hero for `hero`.
const PHOTO_SIZE_PX = { avatar: 96, thumbnail: 240, photo: 400, hero: 1600 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZE_PX;

// Photo Media is fetched directly by the browser as a plain <img src> —
// never through googleApiFetch's header-based auth, since an <img> can't
// attach a custom header. Google's media endpoint takes the key as a query
// param for exactly this.
export function photoMediaUrl(
  photoName: string,
  size: PhotoSize,
  key: string = getGoogleApiKey(),
): string {
  const px = String(PHOTO_SIZE_PX[size]);
  const params = new URLSearchParams({ maxWidthPx: px, maxHeightPx: px, key });
  return `https://places.googleapis.com/v1/${photoName}/media?${params}`;
}

// The image a place shows by default: its primary photo, whichever that is
// when it's drawn.
export function placePrimaryImage(placeId: string): Image {
  return { placePhoto: { placeId }, credit: null, caption: null };
}

// The image to store for a place with no images of its own yet, once a lookup
// shows Google has a photo for it: its primary photo, by reference. Null when the
// place has images, isn't resolved, or Google has none.
export function autoPlaceImage(
  placeId: string | null,
  images: Image[] | undefined,
  photoCount: number,
): Image | null {
  if (images?.length || !placeId || !photoCount) return null;
  return placePrimaryImage(placeId);
}

// A resolved place with no image yet, given its primary photo; any other place
// as is (the same object, so a pass over unchanged places stays cheap).
export function withPrimaryImage<P extends Place | null | undefined>(place: P): P {
  return place?.id && !place.images?.length
    ? { ...place, images: [placePrimaryImage(place.id)] }
    : place;
}

// A place just picked from a search over `previous`, with its primary photo. A
// fresh pick names a different physical place, so it keeps the previous place's
// other fields but none of its images.
export function pickedPlace(
  { id, label, timeZone }: { id: string; label: string; timeZone?: string | null },
  previous?: Place | null,
): Place {
  // The picked place's own zone; never the zone of a different place it replaces.
  const { timeZone: previousZone, ...kept } = previous ?? {};
  const zone = timeZone ?? (previous?.id === id ? previousZone : undefined);
  return {
    ...kept,
    id,
    label,
    ...(zone ? { timeZone: zone } : {}),
    images: [placePrimaryImage(id)],
  };
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

export interface ResolvedImage {
  src: string;
  credit: string | null;
}

// Per place id: its lookup, and its photos once that settles (an empty list
// for a failed lookup) — read synchronously, so a row that re-mounts (or a
// second row naming the same place) draws its photo on the first render.
interface Lookup {
  promise: Promise<void>;
  photos?: PlacePhoto[];
  failedAt?: number;
  // Each image and size drawn from `photos`, resolved once: every row's render
  // peeks at its image.
  resolved: Map<string, ResolvedImage | null>;
}

// How long a failed lookup stands before the next image naming that place
// tries again — long enough that the rows mounting together after one failure
// don't each retry it, short enough that a network blip doesn't blank the
// place's photos until a reload.
const RETRY_AFTER_MS = 30_000;

type PlacePhotos = { photos?: PlacePhoto[] };

// What a resolver asks: a place's photos on their own (the cheap lookup), a full
// lookup already started, the Google key ('' when there's none), and the time.
export interface PhotoSource {
  photosOnly: (placeId: string) => Promise<PlacePhotos>;
  startedLookup: (placeId: string) => Promise<PlacePhotos> | undefined;
  key: () => string;
  now: () => number;
}

// Resolves images through `source`, caching each place's photos.
export function createPhotoResolver(source: PhotoSource) {
  const lookups = new Map<string, Lookup>();

  // Looks up a place's current photos once (again only after a
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
    const retry = known?.failedAt !== undefined && source.now() - known.failedAt > RETRY_AFTER_MS;
    if (known && !retry) return known.promise;
    const photosOnly = () => source.photosOnly(placeId);
    // A started full lookup that failed is no reason to go without photos:
    // they're asked for on their own.
    const lookup = retry
      ? photosOnly()
      : Promise.resolve().then(
          () => source.startedLookup(placeId)?.catch(photosOnly) ?? photosOnly(),
        );
    const entry: Lookup = {
      resolved: new Map(),
      promise: lookup
        .then((details) => {
          entry.photos = details.photos ?? [];
        })
        .catch(() => {
          entry.photos = [];
          entry.failedAt = source.now();
        }),
    };
    lookups.set(placeId, entry);
    return entry.promise;
  }

  // The image as it can be drawn right now: a web image as is, a place photo
  // once its place's photos are known (null when it has none, undefined while
  // they aren't known yet).
  function peekImage(image: Image, size: PhotoSize = 'photo'): ResolvedImage | null | undefined {
    if ('uri' in image) return { src: image.uri, credit: image.credit };
    const lookup = lookups.get(image.placePhoto.placeId);
    if (!lookup?.photos) return undefined;
    const key = `${size}|${imageKey(image)}`;
    let resolved = lookup.resolved.get(key);
    if (resolved === undefined) {
      const photo = matchPlacePhoto(lookup.photos, image.placePhoto);
      resolved = photo
        ? { src: photoMediaUrl(photo.name, size, source.key()), credit: authorOf(photo) ?? null }
        : null;
      lookup.resolved.set(key, resolved);
    }
    return resolved;
  }

  // The image's src and credit, looking up its place's photos if need be. Null
  // when there's nothing to draw: no key, a failed lookup, or no photos.
  async function resolveImage(
    image: Image,
    size: PhotoSize = 'photo',
  ): Promise<ResolvedImage | null> {
    if ('placePhoto' in image) {
      if (!source.key()) return null;
      await lookUpPhotos(image.placePhoto.placeId);
    }
    return peekImage(image, size) ?? null;
  }

  return { peekImage, resolveImage };
}

export const { peekImage, resolveImage } = createPhotoResolver({
  photosOnly: (placeId) => fetchPlaceFields<PlacePhotos>(placeId, 'photos'),
  startedLookup: placeAlreadyRequested,
  key: getGoogleApiKey,
  now: () => Date.now(),
});
