import type { CollectionName } from '../state/TripDataContext';
import type { StagedTripEntities } from './documentImport';
import { loadTripData } from './tripModel';
import type { Leg, Trip, TripData, TripsIndexEntry } from './types';

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// There's no backend this can write to — a static site served from
// public/data/<slug>/*.json has nowhere to save an edit back to. This is
// the other half of that: downloads whichever collection(s) an edit
// actually touched so they can be manually copied back into
// public/data/<slug>/ — the same hand-authoring path this trip's data
// already went through once.
export function exportEdits(data: TripData, dirty: Set<CollectionName>): void {
  for (const collection of dirty) {
    downloadJson(`${collection}.json`, data[collection]);
  }
}

// Same manual-copy-back path, extended to cover a trip that doesn't exist on
// disk at all yet: loadTripData fetches all seven of a trip's files
// unconditionally, so a brand-new trip needs its default Leg's legs.json and
// (when Add trip was started from a document) whatever Stays/Transits/
// Activities that document produced, alongside its trip.json, plus the
// trips.json manifest with this trip's slug added. scenarios/notes are
// always empty — nothing creates those at trip-creation time.
export function exportNewTrip(
  trip: Trip,
  legs: Leg[],
  staged: StagedTripEntities,
  manifest: TripsIndexEntry[],
): void {
  downloadJson('trip.json', trip);
  downloadJson('legs.json', legs);
  downloadJson('stays.json', staged.stays);
  downloadJson('transits.json', staged.transits);
  downloadJson('activities.json', staged.activities);
  downloadJson('scenarios.json', []);
  downloadJson('notes.json', []);
  downloadJson(
    'trips.json',
    manifest.map((entry) => ({ slug: entry.slug })),
  );
}

// Same manual-copy-back path, for editing an existing trip's own top-level
// fields (name, summary — see TripEditDialog) without a slug change: only
// trip.json changed, plus legs.json when TripEditDialog's own "Add a leg"
// section queued any new Legs.
export function exportTripEdit(trip: Trip, legs?: Leg[]): void {
  downloadJson('trip.json', trip);
  if (legs) downloadJson('legs.json', legs);
}

// The slug is never hand-typed anymore (see slug.ts/TripEditDialog) — it's
// derived from the name, so renaming a trip renames its slug too, and the
// slug is also the public/data/<slug>/ directory name. There's still no
// backend that can rename a directory on disk, so this re-fetches every one
// of that trip's own files from its *old* slug's directory (the in-memory
// TripsIndexEntry only carries the subset loadTripsIndex needs for the trips
// list, not scenarios/notes) and re-downloads the complete seven-file set —
// the same full bundle exportNewTrip produces — so the whole directory can
// be copied over to public/data/<newSlug>/ and the old one deleted, same as
// a manual `git mv` would do. legs comes from the caller rather than that
// fetch, since it's the one collection TripsIndexEntry already carries in
// memory — the caller's copy reflects any Leg TripEditDialog's own "Add a
// leg" section queued during this same edit, which the on-disk *old* slug's
// legs.json wouldn't have yet.
export async function exportTripRename(
  oldSlug: string,
  trip: Trip,
  legs: Leg[],
  manifest: TripsIndexEntry[],
): Promise<void> {
  const { stays, transits, activities, scenarios, notes } = await loadTripData(oldSlug);
  downloadJson('trip.json', trip);
  downloadJson('legs.json', legs);
  downloadJson('stays.json', stays);
  downloadJson('transits.json', transits);
  downloadJson('activities.json', activities);
  downloadJson('scenarios.json', scenarios);
  downloadJson('notes.json', notes);
  downloadJson(
    'trips.json',
    manifest.map((entry) => ({ slug: entry.slug })),
  );
}
