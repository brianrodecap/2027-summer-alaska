import type { TripData } from './types';
import type { CollectionName } from '../state/TripDataContext';

// There's no backend this can write to — a static site served from
// public/data/<slug>/*.json has nowhere to save an edit back to. This is
// the other half of that: downloads whichever collection(s) an edit
// actually touched so they can be manually copied back into
// public/data/<slug>/ — the same hand-authoring path this trip's data
// already went through once.
export function exportEdits(data: TripData, dirty: Set<CollectionName>): void {
  for (const collection of dirty) {
    const content = JSON.stringify(data[collection], null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collection}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
