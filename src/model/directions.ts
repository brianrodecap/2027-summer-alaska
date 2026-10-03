// Live drive-time/distance lookups via the Routes API (New) computeRoutes
// endpoint — used by the route editor's place-entry lookup (to fill
// travel.minutes/travel.miles in automatically from two Place IDs instead
// of requiring a hand-typed guess) and by the day timeline's own
// place-to-place travel info (TravelSegmentRow). A separate Google Cloud API
// from Places (see config/places.ts's own key note): the Routes API has to
// be enabled for PLACES_API_KEY too, or every lookup here fails closed (the
// route editor just leaves the fields as they were when that happens, same
// as a failed place search).
import { memoizeAsync } from './asyncCache';
import { googleApiFetch } from './googleApiFetch';
import { persisted } from './idbCache';
import type { Route, RouteVariant, TravelMode } from './types';

const METERS_PER_MILE = 1609.344;

export interface DriveInfo {
  minutes: number;
  miles: number;
}

const CACHE_VERSION = 'v2';
// Two fixed points' travel time/route by a given mode never meaningfully
// changes, same reasoning as elevation.ts's own CACHE_TTL_MS — persisted
// forever rather than on a timer.
const CACHE_TTL_MS = Infinity;

// One computeRoutes call per (origin, destination, mode) triple serves both
// the travel-info (duration/distance) and route-path (polyline) callers
// below — DayMapSidebar wants both for the same segments, so a shared field
// mask/cache avoids issuing the request twice.
const ROUTE_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';

interface RouteLookupResult {
  travel: DriveInfo | null;
  path: LatLngPoint[] | null;
}

const routeCache = new Map<string, Promise<RouteLookupResult>>();

async function fetchRoute(
  originPlaceId: string,
  destinationPlaceId: string,
  mode: TravelMode,
): Promise<RouteLookupResult> {
  const { routes } = await googleApiFetch<{
    routes?: {
      duration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
    }[];
  }>('Routes API', 'https://routes.googleapis.com/directions/v2:computeRoutes', ROUTE_FIELD_MASK, {
    origin: { placeId: originPlaceId },
    destination: { placeId: destinationPlaceId },
    travelMode: mode,
  });
  const duration: string | undefined = routes?.[0]?.duration;
  const distanceMeters: number | undefined = routes?.[0]?.distanceMeters;
  const travel =
    duration && distanceMeters != null
      ? {
          minutes: Math.round(Number(duration.replace('s', '')) / 60),
          miles: Math.round((distanceMeters / METERS_PER_MILE) * 10) / 10,
        }
      : null;
  const encoded = routes?.[0]?.polyline?.encodedPolyline;
  const path = encoded ? decodePolyline(encoded) : null;
  return { travel, path };
}

// Returns null fields when the API returned no route between the two points
// for that mode (e.g. no drivable road to a ferry-only island, or no transit
// service at all in rural Alaska). Throws on a request/auth failure, same as
// places.ts's own fetchPlace/searchPlaces, so the caller's existing
// try/catch handles both alike. Cached per (origin, destination, mode)
// triple, in memory and across visits (idbCache.ts).
function lookupRoute(
  originPlaceId: string,
  destinationPlaceId: string,
  mode: TravelMode,
): Promise<RouteLookupResult> {
  const key = `${originPlaceId}:${destinationPlaceId}:${mode}`;
  const storageKey = `route:${CACHE_VERSION}:${key}`;
  return memoizeAsync(routeCache, key, () =>
    persisted(storageKey, CACHE_TTL_MS, () => fetchRoute(originPlaceId, destinationPlaceId, mode)),
  );
}

export function lookupTravelInfo(
  originPlaceId: string,
  destinationPlaceId: string,
  mode: TravelMode,
): Promise<DriveInfo | null> {
  return lookupRoute(originPlaceId, destinationPlaceId, mode).then((r) => r.travel);
}

// The route editor's own drive-time auto-fill predates the mode picker above
// and only ever wants DRIVE — kept as a thin wrapper so that call site
// doesn't have to spell the mode out.
export function lookupDriveInfo(
  originPlaceId: string,
  destinationPlaceId: string,
): Promise<DriveInfo | null> {
  return lookupTravelInfo(originPlaceId, destinationPlaceId, 'DRIVE');
}

// ---------- a Route's stored travel times ----------
//
// Place ID, each place's travel, and each variant's finalTravel
// are never hand-typed in RouteEditForm — they're re-derived here from Google's
// live drive time and distance (via lookupDriveInfo) every time the stop
// sequence or the route's own From/To changes, walking places[] in its own
// authoritative order (see route-places-array-order-authoritative) rather
// than anything sorted by the durations themselves. A lookup failure (no
// drivable route, API not enabled) just leaves that entry's stored values as
// they were — silently stale until the next successful recompute, same
// fail-closed fallback every place picker already has.
//
// Every leg's origin/destination pair is known synchronously up front (each
// place's own id, chained from the previous stop or From) — none of them
// depend on another leg's lookup result — so the lookups themselves fire
// concurrently rather than one at a time. `fromIndex` additionally skips
// lookups for legs before it: an edit at one stop can only change the origin
// chain from that position onward, so an earlier, already-correct leg is
// left untouched rather than re-fetched.
export async function recomputeVariant(
  variant: RouteVariant,
  fromId: string | null,
  toId: string | null,
  fromIndex = 0,
): Promise<RouteVariant> {
  const legs: { originId: string | null; destId: string | null }[] = [];
  let originId = fromId;
  for (const p of variant.places) {
    const destId = p.place?.id ?? null;
    legs.push({ originId, destId });
    if (destId) originId = destId;
  }
  const finalOriginId = originId;

  const [placeResults, finalInfo] = await Promise.all([
    Promise.all(
      legs.map(({ originId, destId }, i) =>
        i >= fromIndex && originId && destId
          ? lookupDriveInfo(originId, destId).catch(() => null)
          : Promise.resolve(null),
      ),
    ),
    finalOriginId && toId ? lookupDriveInfo(finalOriginId, toId).catch(() => null) : null,
  ]);

  const places = variant.places.map((p, i) => {
    const info = placeResults[i];
    return info ? { ...p, travel: { minutes: info.minutes, miles: info.miles } } : p;
  });

  return {
    ...variant,
    places,
    finalTravel: finalInfo
      ? { minutes: finalInfo.minutes, miles: finalInfo.miles }
      : variant.finalTravel,
  };
}

// Every variant recomputed from scratch — after a Route's From/To changes, or for a
// route drafted elsewhere (the trip assistant) before it's reviewed.
export async function recomputeRouteTravel(route: Route): Promise<Route> {
  const variants = await Promise.all(
    route.variants.map((v) => recomputeVariant(v, route.from.id, route.to.id)),
  );
  return { ...route, variants };
}

// ---------- route-snapped path lookup — DayMapSidebar's own "draw the real
// route, not a straight line" request. Mode-parameterized the same way
// lookupTravelInfo above is, so a segment the reader has switched to WALK/
// BICYCLE/TRANSIT via TravelInfoControl's own picker draws that mode's real
// path, not a driving one. ----------

export interface LatLngPoint {
  lat: number;
  lng: number;
}

// Decodes the Routes API's own polyline encoding (the same format the
// classic Directions API and Google's static Maps API use) into plain
// lat/lng points — a small local implementation of that well-known,
// dependency-free algorithm rather than pulling in the Maps JS API's
// 'geometry' library (google.maps.geometry.encoding.decodePath) for the one
// synchronous decode this needs.
function decodePolyline(encoded: string): LatLngPoint[] {
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function lookupRoutePath(
  originPlaceId: string,
  destinationPlaceId: string,
  mode: TravelMode,
): Promise<LatLngPoint[] | null> {
  return lookupRoute(originPlaceId, destinationPlaceId, mode).then((r) => r.path);
}
