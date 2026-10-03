import { safeGetItem } from '../../config/safeStorage';
import type { Change } from '../../model/changeLog';
import type { TripStore } from './TripStore';

// Bump the version segment if Change's shape ever changes incompatibly — an old log
// under the previous key is then simply ignored rather than misread.
const keyFor = (scope: string) => `itinerary.changes.v1/${scope}`;

export function createLocalStorageTripStore(storage: Storage = window.localStorage): TripStore {
  // The last log read or written per key, with the exact string stored. An append
  // reuses it instead of re-parsing a log that grows with every edit — unless the
  // stored string has changed since (another tab), which is then re-read.
  const parsed = new Map<string, { raw: string; changes: Change[] }>();

  const read = (scope: string): Change[] => {
    const key = keyFor(scope);
    const raw = safeGetItem(key, storage);
    if (!raw) return [];
    const hit = parsed.get(key);
    if (hit?.raw === raw) return hit.changes;
    try {
      const value: unknown = JSON.parse(raw);
      const changes = Array.isArray(value) ? (value as Change[]) : [];
      parsed.set(key, { raw, changes });
      return changes;
    } catch {
      // Corrupt JSON: start from the shipped data rather than failing to load the trip.
      return [];
    }
  };

  // Allowed to throw (blocked storage, a full quota) so the caller can tell the user
  // their edit wasn't saved, instead of it silently vanishing on reload.
  const write = (scope: string, changes: Change[]): void => {
    const key = keyFor(scope);
    if (changes.length === 0) {
      storage.removeItem(key);
      parsed.delete(key);
      return;
    }
    const raw = JSON.stringify(changes);
    storage.setItem(key, raw);
    parsed.set(key, { raw, changes });
  };

  return {
    load: async (scope) => read(scope),
    append: async (scope, changes) => {
      if (changes.length) write(scope, [...read(scope), ...changes]);
    },
    replace: async (scope, changes) => write(scope, changes),
  };
}
