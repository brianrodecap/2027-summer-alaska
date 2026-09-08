import { useCallback } from 'react';

import { COLLECTION_FOR_KIND, type EditKind, patchByKind } from '../model/editForms';
import { withHeroImage } from '../model/formatting';
import type { Image } from '../model/types';
import { useTripData } from './useTripData';

// Makes a clicked photo an entity's own hero image — the one
// firstImage/EntityHeroImage always shows first. Shared by every DetailPanel
// (Activity/Stay/Transit) so the three onSelectImage callbacks can't
// silently diverge on how a hero pick gets written back. `entityId` alone
// (not the whole entity) is what the callback actually needs, so a caller
// passing a fresh entity object on every unrelated field change doesn't
// force this to be rebuilt too.
export function useHeroImageSelect(kind: EditKind, entityId: string | undefined) {
  const { setData } = useTripData();
  return useCallback(
    (image: Image) => {
      if (!entityId) return;
      setData(
        (prev) =>
          patchByKind(prev, kind, entityId, (e) => ({
            ...e,
            images: withHeroImage(e.images, image),
          })),
        [COLLECTION_FOR_KIND[kind]],
      );
    },
    [kind, entityId, setData],
  );
}
