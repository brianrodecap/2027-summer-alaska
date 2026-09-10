import { useCallback } from 'react';

import {
  withActivityPlaceImage,
  withStayPlaceImage,
  withTransitPlaceImage,
} from '../model/editForms';
import type {
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  Image,
} from '../model/types';
import { usePatchEntity } from './useHeroImageSelect';

// Backfills a live Google Places photo onto a specific Place value's own
// `images` — distinct from useHeroImageSelect's entity-level `images` (the
// viewer's own manually-picked hero, which always wins — see firstImage's
// entity-before-place priority). PlacePanel calls this at most once per
// place, only when that place has no images of its own yet, so this never
// overwrites a manual pick. Each hook is just usePatchEntity's kind+id
// wiring plus the matching withXyzPlaceImage pure function from
// editForms.ts, which owns the per-kind "where does this entity's Place
// live" knowledge.
export function useActivityPlaceImagePersist(
  activity: EnrichedActivity | null,
  selectedOption?: EnrichedMealOption,
) {
  const optionId = selectedOption?._id;
  const patchEntity = usePatchEntity('activity', activity?._id);
  return useCallback(
    (image: Image) => patchEntity((e) => withActivityPlaceImage(e, optionId, image)),
    [patchEntity, optionId],
  );
}

export function useStayPlaceImagePersist(stay: EnrichedStay | null) {
  const patchEntity = usePatchEntity('stay', stay?._id);
  return useCallback(
    (image: Image) => patchEntity((e) => withStayPlaceImage(e, image)),
    [patchEntity],
  );
}

export function useTransitPlaceImagePersist(
  transit: EnrichedTransit | null,
  endpoint: 'from' | 'to',
) {
  const patchEntity = usePatchEntity('transit', transit?._id);
  return useCallback(
    (image: Image) => patchEntity((e) => withTransitPlaceImage(e, endpoint, image)),
    [patchEntity, endpoint],
  );
}
