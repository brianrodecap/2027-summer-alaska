// Shared request shape for every Google Places/Routes API (New) call this
// site makes (places.ts's Place Details/Text Search, directions.ts's
// computeRoutes) — same X-Goog-Api-Key auth header and same "throw on a
// non-2xx response" handling, just a different endpoint/field-mask/body per
// caller.
import { PLACES_API_KEY } from '../config/places';

export async function googleApiFetch<T>(
  apiLabel: string,
  url: string,
  fieldMask: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${apiLabel} error ${res.status}`);
  return res.json();
}
