import { useCallback } from 'react';

import {
  COLLECTION_FOR_KIND,
  type EditKind,
  type KindToEntity,
  patchByKind,
} from '../model/editForms';
import { withHeroImage } from '../model/formatting';
import type { Image } from '../model/types';
import { useTripData } from './useTripData';

// The shared skeleton behind every per-entity write that isn't a whole
// edit-form Save (a hero image pick, an auto-backfilled Places photo, ...):
// guard on a missing id, then patch that one entity via setData/patchByKind.
// `entityId` alone (not the whole entity) is what the callback needs, so a
// caller passing a fresh entity object on every unrelated field change
// doesn't force this to be rebuilt too.
export function usePatchEntity<K extends EditKind>(kind: K, entityId: string | undefined) {
  const { setData } = useTripData();
  return useCallback(
    (patch: (entity: KindToEntity[K]) => KindToEntity[K]) => {
      if (!entityId) return;
      setData((prev) => patchByKind(prev, kind, entityId, patch), [COLLECTION_FOR_KIND[kind]]);
    },
    [kind, entityId, setData],
  );
}

// Makes a clicked photo an entity's own hero image — the one
// firstImage/EntityHeroImage always shows first. Shared by every DetailPanel
// (Activity/Stay/Transit) so the three onSelectImage callbacks can't
// silently diverge on how a hero pick gets written back.
export function useHeroImageSelect(kind: EditKind, entityId: string | undefined) {
  const patchEntity = usePatchEntity(kind, entityId);
  return useCallback(
    (image: Image) => patchEntity((e) => ({ ...e, images: withHeroImage(e.images, image) })),
    [patchEntity],
  );
}
