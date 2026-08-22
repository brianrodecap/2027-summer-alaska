// Live drive-time lookups via the Routes API (New) computeRoutes endpoint —
// used only by the route editor's place-entry duration lookup to fill
// durationMinutes in automatically from two Place IDs instead of requiring a
// hand-typed guess. A separate Google Cloud API from Places (see
// config/places.ts's own key note): the Routes API has to be enabled for
// PLACES_API_KEY too, or every lookup here fails closed (the route editor
// just leaves the field hand-editable when that happens, same as a failed
// place search).
import { PLACES_API_KEY } from '../config/places';

const FIELD_MASK = 'routes.duration';

// Returns whole minutes (rounded), or null if the API returned no drivable
// route between the two points (e.g. one endpoint is a ferry-only island).
// Throws on a request/auth failure, same as places.ts's own fetchPlace/
// searchPlaces, so the caller's existing try/catch handles both alike.
export async function lookupDriveMinutes(
  originPlaceId: string,
  destinationPlaceId: string,
): Promise<number | null> {
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
  const duration: string | undefined = routes?.[0]?.duration;
  if (!duration) return null;
  return Math.round(Number(duration.replace('s', '')) / 60);
}
