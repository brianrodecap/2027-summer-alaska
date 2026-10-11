import { createContext } from 'react';

import type { ChangeSource, CollectionName } from '../model/changeLog';
import type { TripData, TripView } from '../model/types';

export type { CollectionName };

export interface TripDataContextValue {
  slug: string;
  data: TripData | null;
  view: TripView | null;
  loading: boolean;
  error: Error | null;
  // Collections with at least one locally saved change (see src/model/changeLog.ts) —
  // persisted across reloads, so this is "not yet copied back into public/data/", not
  // just "edited this session".
  dirtyCollections: Set<CollectionName>;
  canUndo: boolean;
  // Set when the last attempt to persist an edit failed (e.g. storage quota), cleared
  // by the next successful save.
  saveError: Error | null;
  // `source` records who produced the edit, so AI-made changes stay distinguishable
  // in the change log.
  // False when the trip wasn't loaded to write to, so the updater never ran.
  setData: (updater: (prev: TripData) => TripData, source?: ChangeSource) => boolean;
  undoLast: () => void;
}

export const TripDataContext = createContext<TripDataContextValue | null>(null);
