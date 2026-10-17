import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { placePrimaryImage } from '../../model/placePhotos';
import type { PlaceDetails } from '../../model/places';
import type { Place } from '../../model/types';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { PlacePanel } from './PlacePanel';

afterEach(cleanup);

// The full lookup's cache, as places.ts keeps it: getPlace fills it and
// placeAlreadyRequested reads it.
const fullLookups = new Map<string, Promise<PlaceDetails>>();
const getPlace = vi.fn((id: string) => {
  const known = fullLookups.get(id);
  if (known) return known;
  const lookup = Promise.resolve({ photos: [{ name: `places/${id}/photos/a` }] } as PlaceDetails);
  fullLookups.set(id, lookup);
  return lookup;
});
const fetchPlaceFields = vi.fn();

vi.mock('../../model/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model/places')>()),
  getPlace: (id: string) => getPlace(id),
  placeAlreadyRequested: (id: string) => fullLookups.get(id),
  fetchPlaceFields: (...args: unknown[]) => fetchPlaceFields(...args) as unknown,
  isPlacesApiKeyConfigured: () => true,
}));

describe('a detail sheet opening on a resolved place', () => {
  it("makes one Places lookup: the hero reads the panel's full lookup", async () => {
    // The order every detail sheet renders them in: hero first, then the panel.
    const place: Place = { id: 'p_sheet', label: 'Test Place', images: [] };
    render(
      <>
        <EntityHeroImage image={placePrimaryImage('p_sheet')} />
        <PlacePanel place={place} onSelectImage={vi.fn()} onAutoImage={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(getPlace).toHaveBeenCalledWith('p_sheet'));
    await waitFor(() => expect(document.querySelector('img')).not.toBeNull());
    expect(fetchPlaceFields).not.toHaveBeenCalled();
  });
});
