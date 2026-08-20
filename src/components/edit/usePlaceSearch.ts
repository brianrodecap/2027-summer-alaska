import { useEffect, useRef, useState } from 'react';

import { searchPlaces, type PlaceSearchResult } from '../../model/places';

// Live search fires this long after the last keystroke — short enough to
// feel immediate, long enough that a fast typist's early keystrokes never
// each cost their own Text Search call. A query shorter than this many
// characters doesn't search at all — 1-2 letters return too broad/noisy a
// result set to be worth the call.
const DEBOUNCE_MS = 300;
const MIN_LENGTH = 3;

// requestId guards against a slower, earlier search's response landing
// after a faster, later one's and clobbering it — real risk once search
// fires on every keystroke instead of one explicit click.
export function usePlaceSearch(query: string) {
  const [options, setOptions] = useState<PlaceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LENGTH) {
      requestId.current += 1;
      setOptions([]);
      setLoading(false);
      setError(false);
      return;
    }
    const thisRequestId = ++requestId.current;
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      searchPlaces(trimmed)
        .then((results) => {
          if (thisRequestId !== requestId.current) return;
          results.sort((a, b) => a.label.localeCompare(b.label));
          setOptions(results);
          setLoading(false);
        })
        .catch(() => {
          if (thisRequestId !== requestId.current) return;
          setError(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return { options, loading, error };
}
