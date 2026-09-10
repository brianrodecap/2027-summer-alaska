import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Place } from '../../model/types';
import { PlacePanel } from './PlacePanel';

afterEach(cleanup);

vi.mock('./usePlaceDetails', () => ({
  usePlaceDetails: () => ({
    details: { photos: [{ name: 'places/p1/photos/photo_1' }] },
    loading: false,
    failed: false,
    configured: true,
  }),
}));

const place: Place = { id: 'p1', label: 'Test Place', images: [] };

describe('PlacePanel', () => {
  it('backfills onAutoImage once when the place has no images of its own yet', async () => {
    const onAutoImage = vi.fn();
    render(<PlacePanel place={place} onSelectImage={vi.fn()} onAutoImage={onAutoImage} />);

    await waitFor(() => expect(onAutoImage).toHaveBeenCalledTimes(1));
    expect(onAutoImage).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.stringContaining('places/p1/photos/photo_1/media') }),
    );
  });

  it('never calls onAutoImage when the place already has an image', async () => {
    const onAutoImage = vi.fn();
    render(
      <PlacePanel
        place={{ ...place, images: [{ uri: 'existing', credit: null, caption: null }] }}
        onSelectImage={vi.fn()}
        onAutoImage={onAutoImage}
      />,
    );

    // Give the effect a tick to (not) fire before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onAutoImage).not.toHaveBeenCalled();
  });
});
