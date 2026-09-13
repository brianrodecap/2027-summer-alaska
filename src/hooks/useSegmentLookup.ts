import { useKeyedAsync } from './useKeyedAsync';

// A stable empty-Map identity, reused (via cast) everywhere a `useKeyedAsync`
// result hasn't resolved yet — see useKeyedAsync's own note on why a fresh
// object per render would be the wrong default here.
const EMPTY_MAP = new Map() as Map<never, never>;

export interface SegmentLookupResult<T> {
  value: Map<string, T>;
  loading: boolean;
}

// Generic "resolve every segment in a list against an async per-segment
// lookup, tolerating individual failures" hook — shared by DayMapSidebar's
// route-path/travel-info lookups (each segment keyed by its own DOM-row
// identity plus travel mode) and DayTravelChip's whole-day travel total
// (each segment keyed by its origin/destination place-id pair alone, always
// DRIVE). `cacheKey` determines when the whole batch should refetch;
// `resultKey` names each segment's own entry in the returned map — kept
// separate from `cacheKey` since a caller may want the refetch trigger to
// include something (like travel mode) that a result lookup by segment
// identity alone shouldn't have to repeat. A segment whose lookup fails or
// resolves to null is simply absent from the returned map, rather than
// failing the whole batch — one already-successful segment's result
// shouldn't be blanked out by another segment's transient error. `loading`
// is exposed alongside the map for a caller (DayTravelChip) that needs to
// distinguish "still fetching" from "fetched, nothing resolved" — a
// distinction DayMapSidebar's own two consumers don't need, since they just
// fall back to an unresolved segment's straight-line/no-footer treatment
// either way.
export function useSegmentLookup<S, T>(
  segments: S[],
  cacheKey: (segment: S) => string,
  resultKey: (segment: S) => string,
  lookup: (segment: S) => Promise<T | null>,
): SegmentLookupResult<T> {
  const key = segments.map(cacheKey).join(',');
  const { value, loading } = useKeyedAsync(key, segments.length > 0, () =>
    Promise.all(
      segments.map((s) =>
        lookup(s)
          .then((result) => [resultKey(s), result] as const)
          .catch(() => [resultKey(s), null] as const),
      ),
    ).then((entries) => {
      const resolved = new Map<string, T>();
      for (const [segKey, result] of entries) if (result) resolved.set(segKey, result);
      return resolved;
    }),
  );
  return { value: value ?? (EMPTY_MAP as Map<string, T>), loading };
}
