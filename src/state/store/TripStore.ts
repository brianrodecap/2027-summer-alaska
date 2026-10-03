import type { Change } from '../../model/changeLog';

// Where a trip's change log (src/model/changeLog.ts) is persisted. A scope is a trip
// slug, or SHARED_SCOPE for collections every trip shares (routes). Async throughout,
// even though the first implementation (localStorage) is synchronous underneath, so a
// real backend can implement the same interface without callers changing.
export interface TripStore {
  load(scope: string): Promise<Change[]>;
  append(scope: string, changes: Change[]): Promise<void>;
  // Overwrites a scope's whole log — used by Undo, discard, and drift compaction.
  replace(scope: string, changes: Change[]): Promise<void>;
}

export const SHARED_SCOPE = '_shared';
