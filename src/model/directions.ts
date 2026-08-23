// Live drive-time/distance lookups via the Routes API (New) computeRoutes
// endpoint — used only by the route editor's place-entry lookup to fill
// durationMinutes/distanceMiles in automatically from two Place IDs instead
// of requiring a hand-typed guess. A separate Google Cloud API from Places
// (see config/places.ts's own key note): the Routes API has to be enabled
// for PLACES_API_KEY too, or every lookup here fails closed (the route
// editor just leaves the fields as they were when that happens, same as a
// failed place search).
import { PLACES_API_KEY } from '../config/places';

const FIELD_MASK = 'routes.duration,routes.distanceMeters';
const METERS_PER_MILE = 1609.344;

export interface DriveInfo {
  minutes: number;
  miles: number;
}

// Returns null if the API returned no drivable route between the two points
// (e.g. one endpoint is a ferry-only island). Throws on a request/auth
// failure, same as places.ts's own fetchPlace/searchPlaces, so the caller's
// existing try/catch handles both alike.
export async function lookupDriveInfo(
  originPlaceId: string,
  destinationPlaceId: string,
): Promise<DriveInfo | null> {
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
  const distanceMeters: number | undefined = routes?.[0]?.distanceMeters;
  if (!duration || distanceMeters == null) return null;
  return {
    minutes: Math.round(Number(duration.replace('s', '')) / 60),
    miles: Math.round((distanceMeters / METERS_PER_MILE) * 10) / 10,
  };
}
