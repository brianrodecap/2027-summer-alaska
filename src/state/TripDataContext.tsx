import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { buildTripView, loadTripData } from '../model/tripModel';
import type { TripData, TripView } from '../model/types';

// Which raw JSON collection(s) an edit touched — surfaced back to the user so
// "export edits" (still just a client-side download, no backend to write to;
// see EditContext) knows which file(s) actually need re-copying into
// public/data/<slug>/.
export type CollectionName = 'legs' | 'stays' | 'transits' | 'activities' | 'scenarios' | 'notes' | 'routes';

interface TripDataContextValue {
  slug: string;
  data: TripData | null;
  view: TripView | null;
  loading: boolean;
  error: Error | null;
  dirtyCollections: Set<CollectionName>;
  setData: (updater: (prev: TripData) => TripData, dirty?: CollectionName[]) => void;
}

const TripDataContext = createContext<TripDataContextValue | null>(null);

// Recomputes `view` via buildTripView only when `data`'s identity changes —
// a slug switch (the effect below) or a successful edit's setData call —
// mirroring exactly when the model gets rebuilt today.
export function TripDataProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [data, setDataState] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [dirtyCollections, setDirtyCollections] = useState<Set<CollectionName>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setDataState(null);
    setLoading(true);
    setError(null);
    setDirtyCollections(new Set());
    loadTripData(slug)
      .then((loaded) => {
        if (cancelled) return;
        setDataState(loaded);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const view = useMemo(() => (data ? buildTripView(data) : null), [data]);

  const setData = (updater: (prev: TripData) => TripData, dirty: CollectionName[] = []) => {
    setDataState((prev) => (prev ? updater(prev) : prev));
    if (dirty.length) {
      setDirtyCollections((prev) => {
        const next = new Set(prev);
        dirty.forEach((d) => next.add(d));
        return next;
      });
    }
  };

  const value: TripDataContextValue = { slug, data, view, loading, error, dirtyCollections, setData };

  return <TripDataContext.Provider value={value}>{children}</TripDataContext.Provider>;
}

export function useTripData(): TripDataContextValue {
  const ctx = useContext(TripDataContext);
  if (!ctx) throw new Error('useTripData must be used within a TripDataProvider');
  return ctx;
}
