import { useState } from 'react';

import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { imageKey } from '../../model/formatting';
import {
  peekImage,
  type PhotoSize,
  type ResolvedImage,
  resolveImage,
} from '../../model/placePhotos';
import type { Image } from '../../model/types';

// What an <img> needs to draw `image`: its src and credit, resolved live for a
// Google place photo (see placePhotos.ts) at `size`. Null while a place photo's
// lookup is still running, when it has nothing to show, or while `enabled` is
// false — a caller gating on useInViewport passes its `inView` there, so a row
// nobody has scrolled near never looks anything up. Keyed on imageKey, not
// `image`: an edit can hand back an equal image as a new object, which is no
// reason to look it up again.
function useResolvedImage(
  image: Image | null,
  enabled = true,
  size: PhotoSize = 'photo',
): ResolvedImage | null {
  const known = image && enabled ? peekImage(image, size) : null;
  const { value } = useKeyedAsync(
    image ? `${size}|${imageKey(image)}` : null,
    known === undefined,
    () => resolveImage(image as Image, size),
  );
  return known === undefined ? value : known;
}

// useResolvedImage for an <img> that reports its own load failure: null as
// well once `onError` has fired for the src it gave, so the caller draws its
// no-photo fallback instead of a broken image.
export function useDrawableImage(
  image: Image | null,
  { enabled = true, size = 'photo' }: { enabled?: boolean; size?: PhotoSize } = {},
): { resolved: ResolvedImage | null; onError: () => void } {
  const resolved = useResolvedImage(image, enabled, size);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return {
    resolved: resolved && resolved.src !== failedSrc ? resolved : null,
    onError: () => setFailedSrc(resolved?.src ?? null),
  };
}
