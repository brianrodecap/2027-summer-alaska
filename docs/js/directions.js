// Live drive-time lookups via the Routes API (New) computeRoutes endpoint —
// used only by the route editor's place-entry duration lookup (edit.js's
// placeRowNode) to fill durationMinutes in automatically from two Place IDs
// instead of requiring a hand-typed guess. A separate Google Cloud API from
// Places (see places-config.js's own key note): the Routes API has to be
// enabled for PLACES_API_KEY too, or every lookup here fails closed (edit.js
// just leaves the field hand-editable when that happens, same as a failed
// place search).
import { PLACES_API_KEY } from './places-config.js';

const FIELD_MASK = 'routes.duration';

// Returns whole minutes (rounded), or null if the API returned no drivable
// route between the two points (e.g. one endpoint is a ferry-only island).
// Throws on a request/auth failure, same as places.js's own fetchPlace/
// searchPlaces, so the caller's existing try/catch handles both alike.
export async function lookupDriveMinutes(originPlaceId, destinationPlaceId) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      origin: { placeId: originPlaceId },
      destination: { placeId: destinationPlaceId },
      travelMode: 'DRIVE',
    }),
  });
  if (!res.ok) throw new Error(`Routes API error ${res.status}`);
  const { routes } = await res.json();
  const duration = routes?.[0]?.duration;
  if (!duration) return null;
  return Math.round(Number(duration.replace('s', '')) / 60);
}
