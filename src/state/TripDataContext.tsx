import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { buildTripView, loadTripData } from '../model/tripModel';
import type { TripData } from '../model/types';
import {
  type CollectionName,
  TripDataContext,
  type TripDataContextValue,
} from './TripDataContextObject';

interface LoadResult {
  slug: string;
  data: TripData | null;
  error: Error | null;
  dirtyCollections: Set<CollectionName>;
}

const EMPTY_LOAD_RESULT: LoadResult = {
  slug: '',
  data: null,
  error: null,
  dirtyCollections: new Set(),
};

// Recomputes `view` via buildTripView only when `data`'s identity changes —
// a slug switch (the effect below) or a successful edit's setData call —
// mirroring exactly when the model gets rebuilt today.
//
// `result` is keyed by the slug it was loaded for, so a slug change is
// visible immediately at render time (`loading`/`data`/`error` below compare
// `result.slug` to the current `slug` prop) rather than needing the effect to
// fire and reset state first — the effect itself then only ever calls
// setState from its async `loadTripData` callbacks, never synchronously in
// the effect body.
export function TripDataProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [result, setResult] = useState<LoadResult>(EMPTY_LOAD_RESULT);

  useEffect(() => {
    let cancelled = false;
    loadTripData(slug)
      .then((loaded) => {
        if (cancelled) return;
        setResult({ slug, data: loaded, error: null, dirtyCollections: new Set() });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          slug,
          data: null,
          error: err instanceof Error ? err : new Error(String(err)),
          dirtyCollections: new Set(),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const loading = result.slug !== slug;
  const data = loading ? null : result.data;
  const error = loading ? null : result.error;
  const dirtyCollections = loading ? EMPTY_LOAD_RESULT.dirtyCollections : result.dirtyCollections;

  const view = useMemo(() => (data ? buildTripView(data) : null), [data]);

  const setData = useCallback(
    (updater: (prev: TripData) => TripData, dirty: CollectionName[] = []) => {
      setResult((prev) => {
        if (prev.slug !== slug || !prev.data) return prev;
        const next: LoadResult = { ...prev, data: updater(prev.data) };
        if (dirty.length) {
          next.dirtyCollections = new Set(prev.dirtyCollections);
          dirty.forEach((d) => next.dirtyCollections.add(d));
        }
        return next;
      });
    },
    [slug],
  );

  const value: TripDataContextValue = useMemo(
    () => ({ slug, data, view, loading, error, dirtyCollections, setData }),
    [slug, data, view, loading, error, dirtyCollections, setData],
  );

  return <TripDataContext.Provider value={value}>{children}</TripDataContext.Provider>;
}
