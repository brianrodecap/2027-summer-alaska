import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { imageKey } from '../../model/formatting';
import { peekImage, type ResolvedImage, resolveImage } from '../../model/placePhotos';
import type { Image } from '../../model/types';

// What an <img> needs to draw `image`: its src and credit, resolved live for a
// Google place photo (see placePhotos.ts). Null while a place photo's lookup is
// still running, when it has nothing to show, or while `enabled` is false — a
// caller gating on useInViewport passes its `inView` there, so a row nobody
// has scrolled near never looks anything up. Keyed on imageKey, not `image`:
// an edit can hand back an equal image as a new object, which is no reason to
// look it up again.
export function useResolvedImage(image: Image | null, enabled = true): ResolvedImage | null {
  const known = image && enabled ? peekImage(image) : null;
  const { value } = useKeyedAsync(image ? imageKey(image) : null, known === undefined, () =>
    resolveImage(image as Image),
  );
  return known === undefined ? value : known;
}
