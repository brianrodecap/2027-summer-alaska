import { createContext } from 'react';

import type { TripData, TripView } from '../model/types';

// Which raw JSON collection(s) an edit touched — surfaced back to the user so
// "export edits" (still just a client-side download, no backend to write to;
// see EditContext) knows which file(s) actually need re-copying into
// public/data/<slug>/.
export type CollectionName =
  'legs' | 'stays' | 'transits' | 'activities' | 'scenarios' | 'notes' | 'routes';

export interface TripDataContextValue {
  slug: string;
  data: TripData | null;
  view: TripView | null;
  loading: boolean;
  error: Error | null;
  dirtyCollections: Set<CollectionName>;
  setData: (updater: (prev: TripData) => TripData, dirty?: CollectionName[]) => void;
}

export const TripDataContext = createContext<TripDataContextValue | null>(null);
