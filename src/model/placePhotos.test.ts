import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withHeroImage } from './formatting';
import {
  matchPlacePhoto,
  peekImage,
  placePhotoImage,
  placePrimaryImage,
  resolveImage,
} from './placePhotos';
import type { PlacePhoto } from './places';
import type { Image } from './types';

const fetchPlaceFields = vi.fn();
const placeAlreadyRequested = vi.fn();
vi.mock('./places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./places')>()),
  fetchPlaceFields: (...args: unknown[]) => fetchPlaceFields(...args) as unknown,
  placeAlreadyRequested: (...args: unknown[]) => placeAlreadyRequested(...args) as unknown,
  isPlacesApiKeyConfigured: () => true,
}));

const photo = (name: string, author: string, widthPx = 800, heightPx = 600): PlacePhoto => ({
  name,
  widthPx,
  heightPx,
  authorAttributions: [{ displayName: author }],
});

const PHOTOS = [
  photo('places/p1/photos/a', 'Ann'),
  photo('places/p1/photos/b', 'Bo', 1024, 768),
  photo('places/p1/photos/c', 'Bo', 640, 480),
];

describe('matchPlacePhoto', () => {
  it("takes the place's primary photo when no particular one was picked", () => {
    expect(matchPlacePhoto(PHOTOS, { placeId: 'p1' })?.name).toBe('places/p1/photos/a');
  });

  it('finds a picked photo by author and size', () => {
    const ref = { placeId: 'p1', author: 'Bo', widthPx: 640, heightPx: 480 };
    expect(matchPlacePhoto(PHOTOS, ref)?.name).toBe('places/p1/photos/c');
  });

  it("falls back to the author's photo, then the primary, when the exact one is gone", () => {
    const resized = { placeId: 'p1', author: 'Bo', widthPx: 1, heightPx: 1 };
    expect(matchPlacePhoto(PHOTOS, resized)?.name).toBe('places/p1/photos/b');
    expect(matchPlacePhoto(PHOTOS, { placeId: 'p1', author: 'Gone' })?.name).toBe(
      'places/p1/photos/a',
    );
  });

  it('tells apart photos sharing an author and size by which one was picked', () => {
    const owner = [
      photo('places/p1/photos/o1', 'Biz', 4800, 3600),
      photo('places/p1/photos/o2', 'Biz', 4800, 3600),
      photo('places/p1/photos/o3', 'Biz', 4800, 3600),
    ];
    const picked = placePhotoImage('p1', owner[2], owner);
    expect(picked).toMatchObject({ placePhoto: { nth: 2 } });
    if (!('placePhoto' in picked)) throw new Error('expected a place photo');
    expect(matchPlacePhoto(owner, picked.placePhoto)?.name).toBe('places/p1/photos/o3');
  });

  it('finds a picked photo with no author by its size', () => {
    const unattributed = [
      { name: 'places/p1/photos/u1', widthPx: 800, heightPx: 600 },
      { name: 'places/p1/photos/u2', widthPx: 1024, heightPx: 768 },
    ];
    const picked = placePhotoImage('p1', unattributed[1], unattributed);
    if (!('placePhoto' in picked)) throw new Error('expected a place photo');
    expect(picked.placePhoto.author).toBeUndefined();
    expect(matchPlacePhoto(unattributed, picked.placePhoto)?.name).toBe('places/p1/photos/u2');
  });

  it('finds nothing for a place with no photos', () => {
    expect(matchPlacePhoto([], { placeId: 'p1' })).toBeNull();
  });
});

describe('placePhotoImage', () => {
  it('keeps what identifies the photo, never its expiring name', () => {
    const image = placePhotoImage('p1', PHOTOS[1], PHOTOS);
    expect(image).toEqual({
      placePhoto: { placeId: 'p1', author: 'Bo', widthPx: 1024, heightPx: 768 },
      credit: null,
      caption: null,
    });
    expect(JSON.stringify(image)).not.toContain('photos/');
  });
});

describe('withHeroImage', () => {
  it('moves a re-picked place photo to the front instead of adding a copy', () => {
    const web: Image = { uri: 'https://example.test/a.jpg', credit: null, caption: null };
    const picked = placePhotoImage('p1', PHOTOS[1], PHOTOS);
    const images = withHeroImage([web, placePhotoImage('p1', PHOTOS[1], PHOTOS)], picked);
    expect(images).toEqual([picked, web]);
  });

  it('keeps a stored photo that shares its author and size with the picked one', () => {
    const twins = [photo('places/p1/photos/x', 'Di'), photo('places/p1/photos/y', 'Di')];
    const stored = placePhotoImage('p1', twins[0], twins);
    const picked = placePhotoImage('p1', twins[1], twins);
    expect(withHeroImage([stored], picked)).toEqual([picked, stored]);
  });
});

describe('resolveImage', () => {
  beforeEach(() => {
    fetchPlaceFields.mockReset();
    placeAlreadyRequested.mockReset();
  });

  it('draws a web image as is, without a lookup', async () => {
    const web: Image = { uri: 'https://example.test/a.jpg', credit: 'Cy', caption: null };
    expect(await resolveImage(web, 'photo')).toEqual({ src: web.uri, credit: 'Cy' });
    expect(fetchPlaceFields).not.toHaveBeenCalled();
  });

  it("builds the media URL from the place's current photo name, at the asked size", async () => {
    fetchPlaceFields.mockResolvedValue({ photos: PHOTOS });
    const image = placePrimaryImage('place_resolve');
    expect(peekImage(image, 'photo')).toBeUndefined();

    const resolved = await resolveImage(image, 'photo');
    expect(resolved?.src).toMatch(
      /^https:\/\/places\.googleapis\.com\/v1\/places\/p1\/photos\/a\/media\?maxWidthPx=400&/,
    );
    expect(resolved?.credit).toBe('Ann');
    expect(fetchPlaceFields).toHaveBeenCalledWith('place_resolve', 'photos');
    // Known from then on: drawn on the first render, and never looked up again.
    expect(peekImage(image, 'photo')).toEqual(resolved);
    await resolveImage(placePhotoImage('place_resolve', PHOTOS[2], PHOTOS), 'photo');
    expect(fetchPlaceFields).toHaveBeenCalledTimes(1);
  });

  it("resolves each image once per size, and keeps a picked photo's own ref apart", async () => {
    const twins = [photo('places/p1/photos/x', 'Di'), photo('places/p1/photos/y', 'Di')];
    fetchPlaceFields.mockResolvedValue({ photos: twins });
    const first = placePhotoImage('place_sizes', twins[0], twins);
    const second = placePhotoImage('place_sizes', twins[1], twins);
    await resolveImage(first);

    // A row re-rendering gets the very same object back, not an equal copy.
    expect(peekImage(first, 'avatar')).toBe(peekImage(first, 'avatar'));
    expect(peekImage(first, 'avatar')?.src).toMatch(/\/photos\/x\/media\?maxWidthPx=96&/);
    expect(peekImage(first, 'hero')?.src).toMatch(/\/photos\/x\/media\?maxWidthPx=1600&/);
    expect(peekImage(first, 'avatar')?.src).toMatch(/maxWidthPx=96&/);
    // Same author and size, told apart only by which of the two it was.
    expect(peekImage(second, 'avatar')?.src).toMatch(/\/photos\/y\/media\?maxWidthPx=96&/);
  });

  it('draws nothing after a failed lookup, and tries again only after a while', async () => {
    vi.useFakeTimers();
    try {
      fetchPlaceFields.mockRejectedValueOnce(new Error('quota'));
      const image = placePrimaryImage('place_flaky');
      expect(await resolveImage(image, 'photo')).toBeNull();
      expect(peekImage(image)).toBeNull();
      // The rows mounting right after the failure don't each retry it.
      await resolveImage(image);
      expect(fetchPlaceFields).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);
      fetchPlaceFields.mockResolvedValueOnce({ photos: PHOTOS });
      expect((await resolveImage(image))?.credit).toBe('Ann');
      expect(fetchPlaceFields).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a full lookup started right after it in the same commit, instead of its own', async () => {
    // A side sheet's hero asks for the photos first; its PlacePanel's full
    // lookup starts later in the same synchronous pass.
    const image = placePrimaryImage('place_sheet');
    const pending = resolveImage(image, 'photo');
    placeAlreadyRequested.mockImplementation((id: string) =>
      id === 'place_sheet' ? Promise.resolve({ photos: PHOTOS }) : undefined,
    );
    expect((await pending)?.credit).toBe('Ann');
    expect(fetchPlaceFields).not.toHaveBeenCalled();
  });

  it('asks for the photos on their own when no full lookup starts', async () => {
    fetchPlaceFields.mockResolvedValue({ photos: PHOTOS });
    expect((await resolveImage(placePrimaryImage('place_row'), 'photo'))?.credit).toBe('Ann');
    expect(fetchPlaceFields).toHaveBeenCalledWith('place_row', 'photos');
  });

  it('asks for the photos on their own when the full lookup it would read has failed', async () => {
    placeAlreadyRequested.mockReturnValue(Promise.reject(new Error('blip')));
    fetchPlaceFields.mockResolvedValue({ photos: PHOTOS });
    expect((await resolveImage(placePrimaryImage('place_failed_full'), 'photo'))?.credit).toBe(
      'Ann',
    );
    expect(fetchPlaceFields).toHaveBeenCalledWith('place_failed_full', 'photos');
  });

  it('draws nothing for a place Google has no photos for', async () => {
    fetchPlaceFields.mockResolvedValue({});
    expect(await resolveImage(placePrimaryImage('place_bare'), 'photo')).toBeNull();
    expect(peekImage(placePrimaryImage('place_bare'), 'photo')).toBeNull();
  });
});
