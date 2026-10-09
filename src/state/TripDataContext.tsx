import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { withCurrentPricing, withoutOrphanBookings } from '../model/bookings';
import {
  type Change,
  changedCollections,
  type ChangeSource,
  diffTripData,
  replayChanges,
  SHARED_COLLECTIONS,
} from '../model/changeLog';
import { NOTE_TARGET_COLLECTIONS, withoutOrphanNotes } from '../model/notes';
import { buildTripView, loadTripData } from '../model/tripModel';
import type { TripData } from '../model/types';
import { createLocalStorageTripStore } from './store/localStorageTripStore';
import { SHARED_SCOPE, type TripStore } from './store/TripStore';
import { TripDataContext, type TripDataContextValue } from './TripDataContextObject';

const BOOKING_COLLECTIONS = ['bookings', 'legs', 'stays', 'transits', 'activities'] as const;

interface LoadResult {
  slug: string;
  // The trip exactly as shipped in public/data/ — what `changes` replay on top of.
  baseline: TripData | null;
  data: TripData | null;
  changes: Change[];
  error: Error | null;
}

const EMPTY_LOAD_RESULT: LoadResult = {
  slug: '',
  baseline: null,
  data: null,
  changes: [],
  error: null,
};

let defaultStore: TripStore | null = null;
function getDefaultStore(): TripStore {
  defaultStore ??= createLocalStorageTripStore();
  return defaultStore;
}

const scopeOf = (slug: string, change: Change) =>
  SHARED_COLLECTIONS.has(change.collection) ? SHARED_SCOPE : slug;

// Splits a change list into its two storage scopes (this trip's own, and the routes
// every trip shares) and writes each scope `only` lists — by default, every scope for
// 'replace', and just the scopes with something to add for 'append'.
function persist(
  store: TripStore,
  slug: string,
  changes: Change[],
  method: 'replace' | 'append',
  only?: (scope: string) => boolean,
): Promise<unknown> {
  const byScope = new Map<string, Change[]>([
    [slug, []],
    [SHARED_SCOPE, []],
  ]);
  for (const c of changes) byScope.get(scopeOf(slug, c))!.push(c);
  return Promise.all(
    [...byScope]
      .filter(([scope, list]) => (only ? only(scope) : method === 'replace' || list.length > 0))
      .map(([scope, list]) => store[method](scope, list)),
  );
}

// Recomputes `view` via buildTripView only when `data`'s identity changes — a slug
// switch, a successful edit's setData call, or an Undo.
//
// `result` is keyed by the slug it was loaded for, so a slug change is visible
// immediately at render time (`loading`/`data`/`error` below compare `result.slug` to
// the current `slug` prop) rather than needing the effect to fire and reset state first.
//
// Every edit is diffed into per-entity Changes (src/model/changeLog.ts) and persisted
// through `store`, so edits survive a reload; on load, the stored changes are replayed
// over the freshly fetched shipped JSON. The diff runs outside React's state updater
// (against `latest`, a ref mirror of `result`) because it has a side effect — the
// store write — and StrictMode deliberately double-invokes state updaters.
export function TripDataProvider({
  slug,
  store = getDefaultStore(),
  children,
}: {
  slug: string;
  store?: TripStore;
  children: ReactNode;
}) {
  const [result, setResult] = useState<LoadResult>(EMPTY_LOAD_RESULT);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const latest = useRef<LoadResult>(EMPTY_LOAD_RESULT);

  const commit = useCallback((next: LoadResult) => {
    latest.current = next;
    setResult(next);
  }, []);

  const trackSave = useCallback((write: Promise<unknown>) => {
    write.then(
      () => setSaveError(null),
      (err: unknown) => setSaveError(err instanceof Error ? err : new Error(String(err))),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadTripData(slug), store.load(slug), store.load(SHARED_SCOPE)])
      .then(([baseline, own, shared]) => {
        if (cancelled) return;
        // Stable sort, so changes sharing a timestamp keep their stored order.
        const changes = [...shared, ...own].sort((a, b) =>
          a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
        );
        const replayed = replayChanges(baseline, changes);
        const { kept } = replayed;
        const data = { ...replayed.data, bookings: replayed.data.bookings.map(withCurrentPricing) };
        // The shipped JSON moved under some local edits, which drops them — compact them out.
        if (kept.length !== changes.length) trackSave(persist(store, slug, kept, 'replace'));
        commit({ slug, baseline, data, changes: kept, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        commit({
          ...EMPTY_LOAD_RESULT,
          slug,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, store, commit, trackSave]);

  const loading = result.slug !== slug;
  const data = loading ? null : result.data;
  const error = loading ? null : result.error;
  const changes = loading ? EMPTY_LOAD_RESULT.changes : result.changes;
  const dirtyCollections = useMemo(() => changedCollections(changes), [changes]);

  const view = useMemo(() => (data ? buildTripView(data) : null), [data]);

  // Which collections an edit touched isn't passed in — diffTripData finds it.
  const setData = useCallback(
    (updater: (prev: TripData) => TripData, source: ChangeSource = 'manual') => {
      const current = latest.current;
      if (current.slug !== slug || !current.data || !current.baseline) return;
      const updated = updater(current.data);
      if (updated === current.data) return;
      // Pruned here, at the one place every write meets, so bookings.json
      // never collects a booking nothing points at — skipped when the write
      // left bookings and every collection that can hold one untouched.
      const holdersChanged = BOOKING_COLLECTIONS.some((c) => updated[c] !== current.data?.[c]);
      const pruned = holdersChanged ? withoutOrphanBookings(updated) : updated;
      // Same for notes: a deleted entity takes the notes about it along.
      const targetsChanged = NOTE_TARGET_COLLECTIONS.some((c) => pruned[c] !== current.data?.[c]);
      const next = targetsChanged ? withoutOrphanNotes(current.data, pruned) : pruned;
      const added = diffTripData(current.data, next, current.baseline, {
        batch: crypto.randomUUID(),
        at: new Date().toISOString(),
        source,
      });
      commit({ ...current, data: next, changes: [...current.changes, ...added] });
      if (added.length) trackSave(persist(store, slug, added, 'append'));
    },
    [slug, store, commit, trackSave],
  );

  const undoLast = useCallback(() => {
    const current = latest.current;
    const last = current.changes.at(-1);
    if (current.slug !== slug || !current.baseline || !last) return;
    const remaining = current.changes.filter((c) => c.batch !== last.batch);
    const { data: replayed, kept } = replayChanges(current.baseline, remaining);
    commit({ ...current, data: replayed, changes: kept });
    // Only rewrite the scope(s) Undo (or the replay after it) actually dropped changes from.
    const keptSet = new Set(kept);
    const touched = new Set(
      current.changes.filter((c) => !keptSet.has(c)).map((c) => scopeOf(slug, c)),
    );
    trackSave(persist(store, slug, kept, 'replace', (scope) => touched.has(scope)));
  }, [slug, store, commit, trackSave]);

  const value: TripDataContextValue = useMemo(
    () => ({
      slug,
      data,
      view,
      loading,
      error,
      dirtyCollections,
      canUndo: changes.length > 0,
      saveError,
      setData,
      undoLast,
    }),
    [slug, data, view, loading, error, dirtyCollections, changes, saveError, setData, undoLast],
  );

  return <TripDataContext.Provider value={value}>{children}</TripDataContext.Provider>;
}
