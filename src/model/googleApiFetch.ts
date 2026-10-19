// Shared request shape for every Google Places/Routes API (New) call this
// site makes (places.ts's Place Details/Text Search, directions.ts's
// computeRoutes) — same X-Goog-Api-Key auth header and same "throw on a
// non-2xx response" handling, just a different endpoint/field-mask/body per
// caller.
import { getGoogleApiKey } from '../config/apiKeys';
import type { ClientOptions } from './clientOptions';

// A request with a `body` is a POST of it as JSON.
export async function googleApiFetch<T>(
  apiLabel: string,
  url: string,
  fieldMask: string,
  {
    body,
    apiKey: key = getGoogleApiKey(),
    fetch = globalThis.fetch,
  }: ClientOptions & { body?: unknown } = {},
): Promise<T> {
  if (!key) throw new Error('Add your Google API key in Settings.');
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${apiLabel} error ${res.status}`);
  return res.json();
}
