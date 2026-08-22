import { useEffect, useRef, useState } from 'react';

import { type PlaceSearchResult, searchPlaces } from '../../model/places';

// Live search fires this long after the last keystroke — short enough to
// feel immediate, long enough that a fast typist's early keystrokes never
// each cost their own Text Search call. A query shorter than this many
// characters doesn't search at all — 1-2 letters return too broad/noisy a
// result set to be worth the call.
const DEBOUNCE_MS = 300;
const MIN_LENGTH = 3;

interface SearchResult {
  query: string;
  options: PlaceSearchResult[];
  error: boolean;
}

const EMPTY_RESULT: SearchResult = { query: '', options: [], error: false };

// requestId guards against a slower, earlier search's response landing
// after a faster, later one's and clobbering it — real risk once search
// fires on every keystroke instead of one explicit click.
//
// `result` is keyed by the (trimmed) query it was searched for, so
// `options`/`loading`/`error` below are derived by comparing that key to the
// current query at render time — the effect itself only ever calls setState
// from its debounced/async `searchPlaces` callbacks, never synchronously in
// the effect body.
export function usePlaceSearch(query: string) {
  const trimmed = query.trim();
  const shouldSearch = trimmed.length >= MIN_LENGTH;
  const [result, setResult] = useState<SearchResult>(EMPTY_RESULT);
  const requestId = useRef(0);

  useEffect(() => {
    if (!shouldSearch) return;
    const thisRequestId = ++requestId.current;
    const timer = setTimeout(() => {
      searchPlaces(trimmed)
        .then((results) => {
          if (thisRequestId !== requestId.current) return;
          results.sort((a, b) => a.label.localeCompare(b.label));
          setResult({ query: trimmed, options: results, error: false });
        })
        .catch(() => {
          if (thisRequestId !== requestId.current) return;
          setResult({ query: trimmed, options: [], error: true });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, shouldSearch]);

  const options = shouldSearch && result.query === trimmed ? result.options : [];
  const loading = shouldSearch && result.query !== trimmed;
  const error = shouldSearch && result.query === trimmed && result.error;

  return { options, loading, error };
}
