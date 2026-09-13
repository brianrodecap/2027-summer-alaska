import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Polyline,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps';
import { useEffect, useMemo, useState } from 'react';

import { GOOGLE_MAPS_MAP_ID } from '../../config/places';
import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import {
  type DriveInfo,
  type LatLngPoint,
  lookupRoutePath,
  lookupTravelInfo,
} from '../../model/directions';
import { resolveTravelMode } from '../../model/editForms';
import { firstImage, formatMinutes, STAGE_KIND_LABEL } from '../../model/formatting';
import { type Coordinates, getCoordinates } from '../../model/placeCoordinates';
import {
  activityHeadline,
  activityNodeKey,
  type DayMapPlaceRef,
  type DayMapPlaceStop,
  type DayMapRouteNode,
  dayMapRouteNodes,
  dedupeDayMapPlaceStops,
  rowTestId,
  segmentKey,
  stayNodeKey,
  transitBoundaryKey,
  transitRouteLabel,
} from '../../model/tripModel';
import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  TravelMode,
  TravelModeOverride,
} from '../../model/types';
import { useTripData } from '../../state/useTripData';
import {
  activityRowIconName,
  DEFAULT_PLACE_ICON,
  renderMaterialIcon,
  transitModeIconName,
} from '../shared/materialIcon';
import { useDayMapSelections } from './useDayMapSelections';

type OpenHandlers = {
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
};

// A stop's icon reflects whichever kind of entity it is — stay (lodging)
// takes priority over transit-boundary over transit-stage over activity,
// matching how a place named by more than one entity in one day (rare, but
// e.g. a floatplane dock that's also today's photo-op activity) would read
// on the day timeline itself: the "where you're sleeping" story outranks
// the rest, and an actual Depart/Arrive outranks a mere via/waypoint.
function markerIconName(stop: DayMapPlaceStop): string {
  if (stop.refs.some((ref) => ref.kind === 'stay')) return 'hotel';
  const transitRef = stop.refs.find((ref) => ref.kind === 'transit');
  if (transitRef?.kind === 'transit') return transitModeIconName(transitRef.entity);
  if (stop.refs.some((ref) => ref.kind === 'transit-stage')) return 'signpost';
  const activityRef = stop.refs.find((ref) => ref.kind === 'activity');
  if (activityRef?.kind === 'activity') return activityRowIconName(activityRef.entity);
  return DEFAULT_PLACE_ICON;
}

// `placeLabel` is the InfoWindow's own already-shown heading (stop.place.label)
// — a transit-stage's own label is always that same place's name (see
// walkDayMapRefs' pushTransitItemStop, which names the stop from
// `stage.place.label` directly), so spelling it out a second time here would just
// repeat the heading right back at the reader; the kind word alone
// ("Waypoint"/"Via") is the only part this line actually adds.
function refLabel(ref: DayMapPlaceRef, placeLabel: string): string {
  if (ref.kind === 'stay') return ref.relation;
  if (ref.kind === 'transit') {
    return `${ref.phase === 'depart' ? 'Depart' : 'Arrive'} · ${transitRouteLabel(ref.entity)}`;
  }
  if (ref.kind === 'transit-stage') {
    const kindLabel = STAGE_KIND_LABEL[ref.stage.kind] ?? 'Stop';
    return ref.stage.place.label === placeLabel
      ? kindLabel
      : `${kindLabel} · ${ref.stage.place.label}`;
  }
  return activityHeadline(ref.entity) || 'Activity';
}

function openRef(ref: DayMapPlaceRef, handlers: OpenHandlers): void {
  if (ref.kind === 'stay') handlers.onOpenStay(ref.entity);
  else if (ref.kind === 'transit' || ref.kind === 'transit-stage')
    handlers.onOpenTransit(ref.entity);
  else handlers.onOpenActivity(ref.entity);
}

// A stable empty-Map identity, reused (via cast) everywhere a `useKeyedAsync`
// hook below needs a `value ?? EMPTY` fallback — one shared constant instead
// of a separate one per value type.
const EMPTY_MAP = new Map() as Map<never, never>;

// Coordinates are resolved async (a Places API round-trip, cached forever —
// see placeCoordinates.ts) and independently per place id, so markers pop in
// as each one resolves rather than the whole map waiting on the slowest one.
// Keyed on the joined id list (not the array itself, which is a fresh
// reference every render) so this only re-fetches when the actual set of
// places changes, e.g. a scenario-tab switch — the same cancel-stale-fetch
// shape useKeyedAsync already generalizes for a single key.
function usePlaceCoordinates(placeIds: string[]): Map<string, Coordinates> {
  const key = placeIds.join('|');
  const { value } = useKeyedAsync(key, true, () =>
    Promise.all(placeIds.map((id) => getCoordinates(id).then((c) => [id, c] as const))).then(
      (entries) => new Map(entries),
    ),
  );
  return value ?? (EMPTY_MAP as Map<string, Coordinates>);
}

// Matches DayTimeline's own dragId scheme for a Stay/Transit-boundary/
// Activity row (see its `nodes`/`morningStayNodes` construction) so a
// segment here looks up the exact same travelModeOverrides entry
// TravelInfoControl's own mode picker writes to. Returns null — meaning "no
// override lookup possible here, always default to DRIVE" (the same
// default an absent override already means, never a wrong one) — for two
// cases this file's own walk (dayMapRouteNodes) can't reliably match back
// to DayTimeline's: a transit-stage ref (DayTimeline keys those by their
// position in its own flattened sequence, `stage-<transitId>-<tone>-<i>`, an
// index this file has no way to reproduce, since its scenario-tabs handling
// doesn't count the same way DayTimeline's flattened array does), and a
// 'Staying' relation (DayTimeline gives that a second, separately-keyed
// "-morning" node representing "woke up here" that this walk has no
// equivalent for).
function dayTimelineNodeKey(ref: DayMapPlaceRef, date: string): string | null {
  if (ref.kind === 'stay') {
    if (ref.relation === 'Staying') return null;
    return stayNodeKey(ref.entity._id, date);
  }
  if (ref.kind === 'transit') return transitBoundaryKey(ref.entity._id, ref.phase);
  if (ref.kind === 'transit-stage') return null;
  return activityNodeKey(ref.entity._id);
}

// The travel mode this adjacent pair should route with — the reader's own
// override for this exact segment (set via DayTimeline's TravelInfoControl),
// or DRIVE by default. Every adjacent pair gets a real route attempt at
// whatever mode this resolves to, matching TravelInfoControl's own
// universal treatment: it shows a travel-time footer (and a mode picker)
// between *any* two consecutive place-bearing rows, including two plain
// Activities with no Transit between them at all ("pick up rental car" →
// "Walmart Supercenter") and even a flight/ferry Transit's own depart/
// arrive — a Transit is this trip's record of a *booked* journey, not the
// only way two places in a day end up connected by a real route.
function segmentTravelMode(
  a: DayMapRouteNode,
  b: DayMapRouteNode,
  date: string,
  overrides: TravelModeOverride[],
): TravelMode {
  const fromKey = dayTimelineNodeKey(a.ref, date);
  const toKey = dayTimelineNodeKey(b.ref, date);
  if (!fromKey || !toKey) return 'DRIVE';
  return resolveTravelMode(overrides, segmentKey(fromKey, toKey));
}

interface RouteSegment {
  key: string;
  fromPlaceId: string;
  toPlaceId: string;
  fromPoint: Coordinates;
  toPoint: Coordinates;
  mode: TravelMode;
}

// One segment per adjacent pair of currently-visible, coordinate-resolved
// route nodes — walked from dayMapRouteNodes' own undeduped, chronological
// list, not dayMapPlaces' deduped stops: a place visited twice in one day
// (a round-trip Transit's shared from/to) needs its own two separate edges,
// which deduping-by-place would collapse into one — see dayMapRouteNodes'
// own comment. Deliberately not one flat path through all of them either,
// since each segment gets its own real, mode-specific route (useRoutePaths)
// rather than one path drawn straight through every stop. Same-place
// neighbors are skipped entirely (no edge at all), matching
// TravelInfoControl's own "no footer between two rows at the same place"
// rule.
function buildRouteSegments(
  nodes: DayMapRouteNode[],
  coords: Map<string, Coordinates>,
  date: string,
  overrides: TravelModeOverride[],
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const fromPlaceId = nodes[i].place.id as string;
    const toPlaceId = nodes[i + 1].place.id as string;
    if (fromPlaceId === toPlaceId) continue;
    const fromPoint = coords.get(fromPlaceId);
    const toPoint = coords.get(toPlaceId);
    if (!fromPoint || !toPoint) continue;
    segments.push({
      // Keyed by each node's own DOM row identity (domTestIdForRef), not
      // array index — the node list is filtered by viewport visibility
      // (useVisibleRouteNodes), so indices shift on every scroll-driven
      // re-render even when the segment itself hasn't changed. An
      // index-based key would make React remount the <Polyline> component
      // on every such shift, discarding its already-fetched path back to
      // the initial straight-line fallback each time — since the polyline
      // library (see its own usePolyline) only applies the `path` prop as
      // an ongoing update while the SAME instance stays mounted; a fresh
      // mount just re-seeds from whatever `path` happens to be at that
      // moment. A there-and-back day visiting the same two places twice
      // still gets distinct keys here, since each occurrence is a distinct
      // row.
      key: `${domTestIdForRef(nodes[i].ref)}>${domTestIdForRef(nodes[i + 1].ref)}`,
      fromPlaceId,
      toPlaceId,
      fromPoint,
      toPoint,
      mode: segmentTravelMode(nodes[i], nodes[i + 1], date, overrides),
    });
  }
  return segments;
}

// Shared by useRoutePaths and useSegmentTravelInfo below — both fetch off
// the exact same segment set (key + mode), so both need to re-fetch on
// exactly the same change and no more.
function segmentsCacheKey(segments: RouteSegment[]): string {
  return segments.map((s) => `${s.key}:${s.mode}`).join(',');
}

// Shared shape for both per-segment lookups below: fetch `lookup` for every
// segment at its own resolved travel mode, keyed the same way
// buildRouteSegments keys its own segments. Segments not yet resolved (or
// that the API returned no result for) are simply absent from the returned
// map — DayMapSidebarContent falls back to that segment's own straight
// fromPoint→toPoint line meanwhile, the same progressive-reveal treatment
// usePlaceCoordinates already gives markers. One segment's request failing
// (a transient network error, or — while the Routes API was still
// propagating after being newly enabled — an auth error) shouldn't blank out
// every other segment's already-successful result, so a failure is treated
// as "no result" for just that one instead of rejecting the whole
// Promise.all.
function useSegmentLookup<T>(
  segments: RouteSegment[],
  lookup: (segment: RouteSegment) => Promise<T | null>,
): Map<string, T> {
  const key = segmentsCacheKey(segments);
  const { value } = useKeyedAsync(key, segments.length > 0, () =>
    Promise.all(
      segments.map((s) =>
        lookup(s)
          .then((result) => [s.key, result] as const)
          .catch(() => [s.key, null] as const),
      ),
    ).then((entries) => {
      const resolved = new Map<string, T>();
      for (const [segKey, result] of entries) if (result) resolved.set(segKey, result);
      return resolved;
    }),
  );
  return value ?? (EMPTY_MAP as Map<string, T>);
}

// Fetches a real route-snapped path (Routes API, via directions.ts).
function useRoutePaths(segments: RouteSegment[]): Map<string, LatLngPoint[]> {
  return useSegmentLookup(segments, (s) => lookupRoutePath(s.fromPlaceId, s.toPlaceId, s.mode));
}

// Per-segment drive time/distance (Routes API), fetched for exactly the same
// segments — same origin/destination/mode — buildRouteSegments already draws
// as a polyline, so a marker's own InfoWindow can report "N min · N mi to
// <next place>" for whichever leg leaves from it, and that number always
// agrees with the line actually drawn on the map.
function useSegmentTravelInfo(segments: RouteSegment[]): Map<string, DriveInfo> {
  return useSegmentLookup(segments, (s) => lookupTravelInfo(s.fromPlaceId, s.toPlaceId, s.mode));
}

// The same data-testid DayTimeline's own TimelineRow stamps on every row
// (`stay-row-<key>`, `transit-boundary-<key>`, `transit-stage-<key>`,
// `activity-row-<id>`) — see dayMapPlaces' own comment for why `rowKey`
// exists on those ref variants. Letting this map read that attribute
// straight off the DOM means DayTimeline never has to know a map exists.
function domTestIdForRef(ref: DayMapPlaceRef): string {
  if (ref.kind === 'stay') return rowTestId('stay', ref.rowKey);
  if (ref.kind === 'transit') return rowTestId('transit-boundary', ref.rowKey);
  if (ref.kind === 'transit-stage') return rowTestId('transit-stage', ref.rowKey);
  return rowTestId('activity', ref.entity._id);
}

// "Currently displayed on the timeline" — of everything resolvable for the
// active day, only the subset whose own row is presently somewhere in the
// viewport, not the day's whole content (a day's own timeline routinely
// runs far taller than one screen). Scoped to just this day's own section
// (`#day-<date>`) rather than the whole document, so a rowKey that happens
// to collide with another day's never gets watched by mistake. Falls back
// to every watched id when nothing's been detected yet (first paint, before
// the observer's initial callback lands, or a day short enough that nothing
// distinctly enters/exits) rather than reporting an empty set. Watches
// routeNodes' own rows — stops' refs are the same rows regrouped by place
// (see dedupeDayMapPlaceStops), so one observer over routeNodes' testIds
// covers both the marker list and the route-node list below.
function useVisibleTestIds(day: Day, testIds: string[]): Set<string> {
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const idsKey = `${day.date}|${testIds.join(',')}`;

  useEffect(() => {
    const dayRoot = document.getElementById(`day-${day.date}`);
    if (!dayRoot) return;

    const testIdByElement = new Map<Element, string>();
    const seen = new Set<string>();
    for (const testId of testIds) {
      if (seen.has(testId)) continue;
      seen.add(testId);
      const el = dayRoot.querySelector(`[data-testid="${testId}"]`);
      if (el) testIdByElement.set(el, testId);
    }
    if (testIdByElement.size === 0) return;

    const intersecting = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const testId = testIdByElement.get(entry.target);
        if (!testId) continue;
        if (entry.isIntersecting) intersecting.add(testId);
        else intersecting.delete(testId);
      }
      setVisible(new Set(intersecting));
    });
    testIdByElement.forEach((_testId, el) => observer.observe(el));
    return () => observer.disconnect();
    // day/testIds are fresh every render; idsKey is their stable "which day,
    // which resolvable rows" identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return visible;
}

// One shared visible-rows observer for both the marker list (deduped by
// place) and the route-node list (one entry per chronological occurrence,
// see dedupeDayMapPlaceStops' own comment for why a round-trip Transit's two
// visits to one place need to stay distinct) — both are filtered views over
// the exact same set of DOM rows, so they read off one Set rather than each
// standing up their own IntersectionObserver.
function useVisibleDayMapEntries(
  day: Day,
  stops: DayMapPlaceStop[],
  nodes: DayMapRouteNode[],
): { visibleStops: DayMapPlaceStop[]; visibleRouteNodes: DayMapRouteNode[] } {
  const testIds = nodes.map((node) => domTestIdForRef(node.ref));
  const visibleTestIds = useVisibleTestIds(day, testIds);
  if (visibleTestIds.size === 0) return { visibleStops: stops, visibleRouteNodes: nodes };
  return {
    visibleStops: stops.filter((stop) =>
      stop.refs.some((ref) => visibleTestIds.has(domTestIdForRef(ref))),
    ),
    visibleRouteNodes: nodes.filter((node) => visibleTestIds.has(domTestIdForRef(node.ref))),
  };
}

// Frames every resolved point once (or re-centers on the one point when
// there's only one) rather than on every render, so a reader who's since
// panned/zoomed by hand doesn't get snapped back — see pointsKey below.
function FitBoundsToPoints({ points, pointsKey }: { points: Coordinates[]; pointsKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 32);
    // points itself is a fresh array every render; pointsKey is the stable
    // "which places, resolved" identity this should actually react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointsKey]);
  return null;
}

// What a marker's InfoWindow reports about the leg leaving from this stop —
// absent when this is the day's last mapped place, or nothing plausible
// mapped after it (e.g. the next node's coordinates never resolved).
interface NextPlaceInfo {
  label: string;
  travel: DriveInfo | null;
}

// One marker per resolved place, matching the day timeline's own monochrome
// outlined-dot treatment (RowLeadingDot) rather than a colored pin, so the
// map reads as part of the same system. Clicking opens an InfoWindow listing
// every Stay/Transit/Activity that named this place — almost always one,
// but never assumed to be — each of which opens that entity's own detail
// side sheet, the same one its day-list row opens.
//
// The InfoWindow's own content sits inside Google's fixed white popup
// chrome, not this app's own MUI surfaces — unlike every other panel in the
// app, it never picks up the site's dark theme, so its text needs its own
// explicit dark-on-light colors rather than theme text tokens (this app's
// `text.primary`/`text.secondary` are a cream/tan pair tuned for the site's
// own dark ground, and read as washed-out low-contrast text on Google's
// forced-white background).
function PlaceMarker({
  stop,
  coordinates,
  nextPlace,
  ...handlers
}: {
  stop: DayMapPlaceStop;
  coordinates: Coordinates;
  nextPlace: NextPlaceInfo | null;
} & OpenHandlers) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(false);
  const image = firstImage(stop.place);
  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={coordinates}
        title={stop.place.label}
        onClick={() => setInfoOpen((open) => !open)}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            bgcolor: 'background.paper',
            border: '2px solid',
            borderColor: 'grey.500',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 1,
          }}
        >
          {renderMaterialIcon(markerIconName(stop), { fontSize: 'small' })}
        </Box>
      </AdvancedMarker>
      {infoOpen && (
        <InfoWindow anchor={marker} onClose={() => setInfoOpen(false)} maxWidth={280}>
          <Stack spacing={0.5} sx={{ py: 0.5, minWidth: 200 }}>
            {image && (
              <Box
                component="img"
                src={image.uri}
                alt=""
                sx={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 1 }}
              />
            )}
            <Typography variant="subtitle2" sx={{ color: 'rgba(0, 0, 0, 0.87)', fontWeight: 700 }}>
              {stop.place.label}
            </Typography>
            {stop.refs.map((ref, i) => (
              <ButtonBase
                key={i}
                onClick={() => {
                  setInfoOpen(false);
                  openRef(ref, handlers);
                }}
                sx={{
                  display: 'block',
                  textAlign: 'left',
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="body2" sx={{ color: '#1a56b0' }}>
                  {refLabel(ref, stop.place.label)}
                </Typography>
              </ButtonBase>
            ))}
            {nextPlace && (
              <Typography variant="caption" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                {nextPlace.travel
                  ? `~${formatMinutes(nextPlace.travel.minutes)} · ${nextPlace.travel.miles} mi to ${nextPlace.label}`
                  : `Next: ${nextPlace.label}`}
              </Typography>
            )}
          </Stack>
        </InfoWindow>
      )}
    </>
  );
}

// The single persistent map panel beside the day list (DaysView, when the
// viewport has room — see the lg-breakpoint gate there) — a richer sibling
// to DayMapPanel's own keyless iframe embed: real markers per place, each
// clickable straight through to that place's own Stay/Transit/Activity
// detail sheet(s), rather than a static picture of a start→end route. Needs
// the Maps JavaScript API (loaded once, at the app root — see main.tsx's
// APIProvider) and a real Map ID (GOOGLE_MAPS_MAP_ID) for AdvancedMarker to
// render at all.
//
// One map, not one per day: DaysView tracks whichever Day block the reader
// has scrolled to (useActiveDayDate) and swaps this same map's markers to
// match, rather than standing up a separate live google.maps.Map instance
// per day — DaysView renders every Day block unvirtualized (~28+ for this
// trip), so the latter would mean that many concurrent map/WebGL contexts.
export function DayMapSidebar({
  activeDay,
  ...handlers
}: { activeDay: Day | null } & OpenHandlers) {
  if (!activeDay) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="body2" color="text.secondary" align="center">
          Scroll to a day to see it on the map.
        </Typography>
      </Box>
    );
  }
  return <DayMapSidebarContent day={activeDay} {...handlers} />;
}

function DayMapSidebarContent({
  day,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: { day: Day } & OpenHandlers) {
  const selections = useDayMapSelections(day);
  // One walk of the day's sequence, shared by both the deduped markers below
  // and the route line's own undeduped nodes — see dedupeDayMapPlaceStops'
  // own comment for why a place visited twice in one day (a round-trip
  // Transit's shared from/to) needs two separate route nodes even though it
  // gets one marker.
  const routeNodes = useMemo(() => dayMapRouteNodes(day, selections), [day, selections]);
  const stops = useMemo(() => dedupeDayMapPlaceStops(routeNodes), [routeNodes]);
  // dedupeDayMapPlaceStops only ever adds a stop once its place has a real
  // Google Place id (see walkDayMapRefs' own comment), so this cast is safe.
  const placeIds = stops.map((stop) => stop.place.id as string);
  // Resolved (has real coordinates) over every one of the day's stops, not
  // just the currently-visible ones — so a place that's already warm stays
  // warm as the reader scrolls past it again, rather than re-fetching.
  const coords = usePlaceCoordinates(placeIds);
  // "Currently displayed on the timeline" over every stop, not just the
  // resolved ones — a place still awaiting its coordinates shouldn't count
  // as invisible and get excluded once it does resolve.
  const { visibleStops, visibleRouteNodes } = useVisibleDayMapEntries(day, stops, routeNodes);
  const visibleResolvedStops = visibleStops.filter((stop) => coords.has(stop.place.id as string));
  const points = visibleResolvedStops.map(
    (stop) => coords.get(stop.place.id as string) as Coordinates,
  );
  const pointsKey = visibleResolvedStops
    .map((stop) => stop.place.id)
    .sort()
    .join(',');
  const routeColor = useTheme().palette.primary.main;
  // travelModeOverrides may be undefined while the trip's own data is still
  // loading — segmentTravelMode's own default (DRIVE) applies to every
  // segment in that case, same as once it's loaded but simply has no
  // override for a given one.
  const { data } = useTripData();
  const overrides = data?.travelModeOverrides;
  const routeSegments = useMemo(
    () => buildRouteSegments(visibleRouteNodes, coords, day.date, overrides ?? []),
    [visibleRouteNodes, coords, day.date, overrides],
  );
  const routePaths = useRoutePaths(routeSegments);
  const segmentTravelInfo = useSegmentTravelInfo(routeSegments);
  // Every stop's own place label, keyed by id — not just the currently
  // visible/resolved ones, since a marker's "next place" can point at one
  // that's off in a not-yet-scrolled-to part of the day.
  const placeLabelById = useMemo(
    () => new Map(stops.map((stop) => [stop.place.id as string, stop.place.label])),
    [stops],
  );
  // The first (chronologically earliest) segment leaving each place — a
  // round-trip day visiting the same place twice has more than one, but a
  // marker only ever needs one "next place" line, not one per occurrence.
  const nextPlaceByStopId = useMemo(() => {
    const result = new Map<string, NextPlaceInfo>();
    for (const segment of routeSegments) {
      if (result.has(segment.fromPlaceId)) continue;
      const label = placeLabelById.get(segment.toPlaceId);
      if (!label) continue;
      result.set(segment.fromPlaceId, {
        label,
        travel: segmentTravelInfo.get(segment.key) ?? null,
      });
    }
    return result;
  }, [routeSegments, placeLabelById, segmentTravelInfo]);

  if (stops.length === 0) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="body2" color="text.secondary" align="center">
          Nothing resolvable to map yet for this day.
        </Typography>
      </Box>
    );
  }

  return (
    <GoogleMap
      mapId={GOOGLE_MAPS_MAP_ID}
      style={{ width: '100%', height: '100%' }}
      defaultCenter={points[0] ?? { lat: 61.2181, lng: -149.9003 }}
      defaultZoom={9}
    >
      <FitBoundsToPoints points={points} pointsKey={pointsKey} />
      {routeSegments.map((segment) => (
        <Polyline
          key={segment.key}
          path={routePaths.get(segment.key) ?? [segment.fromPoint, segment.toPoint]}
          strokeColor={routeColor}
          strokeOpacity={0.8}
          strokeWeight={3}
        />
      ))}
      {visibleResolvedStops.map((stop) => (
        <PlaceMarker
          key={stop.place.id}
          stop={stop}
          coordinates={coords.get(stop.place.id as string) as Coordinates}
          nextPlace={nextPlaceByStopId.get(stop.place.id as string) ?? null}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
        />
      ))}
    </GoogleMap>
  );
}
