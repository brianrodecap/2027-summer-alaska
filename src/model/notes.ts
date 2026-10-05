import type { Note, Ref, RefEntityKind, TripData } from './types';

// The collections a Note's entity refs can point into — a write that leaves
// all of them untouched can't have orphaned a note.
export const NOTE_TARGET_COLLECTIONS = [
  'trip',
  'legs',
  'stays',
  'transits',
  'routes',
  'activities',
  'scenarios',
] as const;

type NoteTargets = Pick<TripData, (typeof NOTE_TARGET_COLLECTIONS)[number] | 'notes'>;

const refKey = (entity: RefEntityKind, id: string) => `${entity}:${id}`;

function liveEntityKeys(data: NoteTargets): Set<string> {
  const keys = new Set<string>([refKey('trip', data.trip._id)]);
  for (const l of data.legs) keys.add(refKey('leg', l._id));
  for (const s of data.stays) {
    keys.add(refKey('stay', s._id));
    for (const p of s.packages ?? []) keys.add(refKey('package', p._id));
  }
  for (const t of data.transits) keys.add(refKey('transit', t._id));
  for (const r of data.routes) keys.add(refKey('route', r._id));
  for (const a of data.activities) {
    keys.add(refKey('activity', a._id));
    for (const o of a.options ?? []) keys.add(refKey('mealOption', o._id));
  }
  for (const s of data.scenarios) keys.add(refKey('scenario', s._id));
  return keys;
}

// `next` with every Note ref to an entity this write deleted (live in `prev`,
// gone from `next`) dropped, and every Note left with no refs at all dropped
// with it — a note that also names a date or a surviving entity keeps those.
// Refs that already dangled before the write are left alone, so an unrelated
// edit never sweeps them up. The same object when nothing was orphaned.
// TripDataContext.setData runs it on every write (like withoutOrphanBookings),
// so no delete path — an entity, a scenario, a route, a meal option, a
// package — has to remember to.
export function withoutOrphanNotes<T extends NoteTargets>(prev: NoteTargets, next: T): T {
  const live = liveEntityKeys(next);
  const deleted = new Set([...liveEntityKeys(prev)].filter((key) => !live.has(key)));
  if (!deleted.size) return next;
  const keep = (ref: Ref) => !('entity' in ref) || !deleted.has(refKey(ref.entity, ref.id));
  let changed = false;
  const notes: Note[] = [];
  for (const note of next.notes) {
    if (note.concerns.every(keep)) {
      notes.push(note);
      continue;
    }
    changed = true;
    const concerns = note.concerns.filter(keep);
    if (concerns.length) notes.push({ ...note, concerns });
  }
  return changed ? { ...next, notes } : next;
}
