import type { Coordinates } from '../model/placeCoordinates';
import { getCoordinates } from '../model/placeCoordinates';
import { EMPTY_MAP, useKeyedAsync } from './useKeyedAsync';

// Coordinates are resolved async (a Places API round-trip, cached forever —
// see placeCoordinates.ts) and independently per place id, then handed back
// together. A place whose lookup fails is simply absent, rather than blanking
// every other one. Keyed on the joined id list (not the array itself, which is
// a fresh reference every render) so this only re-fetches when the set of
// places changes — the same cancel-stale-fetch shape useKeyedAsync already
// generalizes for a single key.
export function usePlaceCoordinates(placeIds: string[]): Map<string, Coordinates> {
  const key = placeIds.join('|');
  const { value } = useKeyedAsync(key, true, () =>
    Promise.all(
      placeIds.map((id) =>
        getCoordinates(id)
          .then((c) => [id, c] as const)
          .catch(() => null),
      ),
    ).then((entries) => new Map(entries.filter((e) => e !== null))),
  );
  return value ?? (EMPTY_MAP as Map<string, Coordinates>);
}
