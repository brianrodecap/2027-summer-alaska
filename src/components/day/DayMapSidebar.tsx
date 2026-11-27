import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import {
  InfoWindow,
  Map as GoogleMap,
  Polyline,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { useMemo, useState } from 'react';

import { GOOGLE_MAPS_MAP_ID } from '../../config/places';
import { usePlaceCoordinates } from '../../hooks/usePlaceCoordinates';
import { useSegmentLookup } from '../../hooks/useSegmentLookup';
import {
  isAboardHop,
  mapRefRowId,
  mapRouteNodes,
  numberedMapStops,
  pinLabel,
} from '../../model/dayMap';
import {
  type DriveInfo,
  type LatLngPoint,
  lookupRoutePath,
  lookupTravelInfo,
} from '../../model/directions';
import { resolveTravelMode } from '../../model/editForms';
import { firstImage, formatTravel, STAGE_KIND_LABEL } from '../../model/formatting';
import type { Coordinates } from '../../model/placeCoordinates';
import {
  activeTrackOf,
  activityHeadline,
  type DayMapPlaceRef,
  type DayMapPlaceStop,
  type DayMapRouteNode,
  segmentKey,
  transitRouteLabel,
} from '../../model/tripModel';
import type { Day, TravelMode, TravelModeOverride } from '../../model/types';
import { cardId } from '../../state/expandedRows';
import { useExpandedRows } from '../../state/useExpandedRow';
import { useTripData } from '../../state/useTripData';
import { FitBoundsToPoints } from '../shared/FitBoundsToPoints';
import { planColor } from '../shared/planColor';
import { MapButtons, PreviewMarker, RingMarker } from '../shared/PlannerMapParts';
import { PreviewBar } from '../shared/PreviewBar';
import { PreviewStartButton } from '../shared/PreviewStartButton';
import { PREVIEW_NEEDS_PLACES } from '../shared/previewText';
import { TripImage } from '../shared/TripImage';
import { dayElementId } from './dayLayout';
import { useDayPreview } from './useDayPreview';

// `placeLabel` is the InfoWindow's own already-shown heading (stop.place.label)
// — a transit-stage's own label is always that same place's name (see
// mapRouteNodes in dayMap.ts, which names the stop from
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

const FIT_PADDING = { top: 40, right: 32, bottom: 100, left: 32 };

const POLL_MS = 100;
const UNFOLD_TRIES = 20;

// Runs `done` once `ready` is true, or after about two seconds regardless.
function whenReady(ready: () => boolean, done: () => void, tries = UNFOLD_TRIES) {
  window.setTimeout(() => {
    if (ready() || tries <= 1) done();
    else whenReady(ready, done, tries - 1);
  }, POLL_MS);
}

// Brings the day-list card a pin's entry stands for into view, opening it if it is
// one that opens, and unfolding its day if that is collapsed. False when the list
// doesn't show the row: the filters hide it.
function useRevealCard(date: string) {
  const rows = useExpandedRows();
  return (ref: DayMapPlaceRef): boolean => {
    const id = cardId(date, mapRefRowId(ref));
    const find = () => document.querySelector(`[data-card="${id}"]`);
    const folded = document.querySelector<HTMLElement>(
      `#${dayElementId(date)} .MuiAccordionSummary-root[aria-expanded="false"]`,
    );
    if (!folded && !find()) return false;
    rows.open(id);
    folded?.click();
    // once the card is there and its day has finished unfolding
    whenReady(
      () => Boolean(find()?.closest('.MuiAccordion-root')?.querySelector('.MuiCollapse-entered')),
      () => find()?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    return true;
  };
}

// The travel mode this adjacent pair should route with — the reader's own
// override for this exact segment (set via DayTimeline's TravelInfoControl),
// or DRIVE by default. Every adjacent pair not carried by a flight or ferry
// (isAboardHop) gets a real route attempt at whatever mode this resolves to,
// matching TravelInfoControl's own universal treatment: it shows a
// travel line (and a mode picker) between *any* two consecutive
// place-bearing rows, including two plain Activities with no Transit between
// them at all ("pick up rental car" → "Walmart Supercenter").
function segmentTravelMode(
  a: DayMapRouteNode,
  b: DayMapRouteNode,
  overrides: TravelModeOverride[],
): TravelMode {
  if (!a.nodeKey || !b.nodeKey) return 'DRIVE';
  return resolveTravelMode(overrides, segmentKey(a.nodeKey, b.nodeKey));
}

interface RouteSegment {
  key: string;
  fromIndex: number; // the node the leg leaves from
  fromPlaceId: string;
  toPlaceId: string;
  fromPoint: Coordinates;
  toPoint: Coordinates;
  mode: TravelMode;
}

// One segment per adjacent pair of currently-visible, coordinate-resolved
// route nodes — walked from mapRouteNodes' own undeduped, chronological
// list, not the deduped stops: a place visited twice in one day
// (a round-trip Transit's shared from/to) needs its own two separate edges,
// which deduping-by-place would collapse into one — see mapRouteNodes'
// own comment. Deliberately not one flat path through all of them either,
// since each segment gets its own real, mode-specific route (useRoutePaths)
// rather than one path drawn straight through every stop. Same-place
// neighbors (matching TravelInfoControl's own "no travel line between two rows at
// the same place" rule) and hops a flight or ferry carries (isAboardHop) are
// skipped entirely: no edge at all.
function buildRouteSegments(
  nodes: DayMapRouteNode[],
  coords: Map<string, Coordinates>,
  overrides: TravelModeOverride[],
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const fromPlaceId = nodes[i].place.id as string;
    const toPlaceId = nodes[i + 1].place.id as string;
    if (fromPlaceId === toPlaceId || isAboardHop(nodes[i], nodes[i + 1])) continue;
    const fromPoint = coords.get(fromPlaceId);
    const toPoint = coords.get(toPlaceId);
    if (!fromPoint || !toPoint) continue;
    segments.push({
      // Keyed by the two rows it joins, not by position, so a Polyline stays mounted
      // as other legs come and go: the polyline library applies a new `path` only to
      // a mounted instance, and a remount would show the straight-line fallback
      // again. A day visiting the same places twice still gets distinct keys.
      key: `${mapRefRowId(nodes[i].ref)}>${mapRefRowId(nodes[i + 1].ref)}`,
      fromIndex: i,
      fromPlaceId,
      toPlaceId,
      fromPoint,
      toPoint,
      mode: segmentTravelMode(nodes[i], nodes[i + 1], overrides),
    });
  }
  return segments;
}

// Both per-segment lookups below fetch off the exact same segment set (key +
// mode) via the shared useSegmentLookup hook, so both need to re-fetch on
// exactly the same change and no more; results stay mapped by each segment's
// own key alone (not key+mode) since that's what DayMapSidebarContent looks
// them up by below.
function segmentCacheKey(segment: RouteSegment): string {
  return `${segment.key}:${segment.mode}`;
}

function segmentResultKey(segment: RouteSegment): string {
  return segment.key;
}

// Fetches a real route-snapped path (Routes API, via directions.ts).
// Segments not yet resolved (or that the API returned no result for) are
// simply absent from the returned map — DayMapSidebarContent falls back to
// that segment's own straight fromPoint→toPoint line meanwhile, the same
// progressive-reveal treatment usePlaceCoordinates already gives markers.
function useRoutePaths(segments: RouteSegment[]): Map<string, LatLngPoint[]> {
  return useSegmentLookup(segments, segmentCacheKey, segmentResultKey, (s) =>
    lookupRoutePath(s.fromPlaceId, s.toPlaceId, s.mode),
  ).value;
}

// Per-segment drive time/distance (Routes API), fetched for exactly the same
// segments — same origin/destination/mode — buildRouteSegments already draws
// as a polyline, so a marker's own InfoWindow can report "N min · N mi to
// <next place>" for whichever leg leaves from it, and that number always
// agrees with the line actually drawn on the map.
function useSegmentTravelInfo(segments: RouteSegment[]): Map<string, DriveInfo> {
  return useSegmentLookup(segments, segmentCacheKey, segmentResultKey, (s) =>
    lookupTravelInfo(s.fromPlaceId, s.toPlaceId, s.mode),
  ).value;
}

// What a pin's InfoWindow reports about the leg leaving from its stop — absent
// when this is the plan's last mapped place, or nothing plausible mapped after
// it (e.g. the next node's coordinates never resolved).
interface NextPlaceInfo {
  label: string;
  travel: DriveInfo | null;
}

// One pin per resolved place, carrying its rows' numbers: the route planner's ring, in its plan's
// color. Clicking opens an InfoWindow listing every Stay/Transit/Activity that
// named this place — almost always one, but never assumed to be — each of which
// opens that entry's card in the day list.
//
// The InfoWindow's own content sits inside Google's fixed white popup chrome, not
// this app's own MUI surfaces — unlike every other panel in the app, it never
// picks up the site's dark theme, so its text needs its own explicit dark-on-light
// colors rather than theme text tokens.
function PlaceMarker({
  stop,
  label,
  color,
  active,
  coordinates,
  nextPlace,
  onReveal,
}: {
  stop: DayMapPlaceStop;
  label: string;
  color: string;
  active: boolean;
  coordinates: Coordinates;
  nextPlace: NextPlaceInfo | null;
  onReveal: (ref: DayMapPlaceRef) => boolean;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <RingMarker
        markerRef={markerRef}
        position={coordinates}
        color={color}
        glyph={label}
        name={stop.place.label}
        active={active}
        onClick={() => {
          setHidden(false);
          setInfoOpen((open) => !open);
        }}
      />
      {infoOpen && (
        <InfoWindow anchor={marker} onClose={() => setInfoOpen(false)} maxWidth={280}>
          <Stack spacing={0.5} sx={{ py: 0.5, minWidth: 200 }}>
            {/* Mounted only while the info window is open, so a marker nobody
                clicks never looks up its photo. */}
            <TripImage
              image={firstImage(stop.place)}
              sx={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 1 }}
            />
            <Typography variant="subtitle2" sx={{ color: 'rgba(0, 0, 0, 0.87)', fontWeight: 700 }}>
              {stop.place.label}
            </Typography>
            {stop.refs.map((ref, i) => (
              <ButtonBase
                key={i}
                onClick={() => {
                  const shown = onReveal(ref);
                  setHidden(!shown);
                  if (shown) setInfoOpen(false);
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
            {hidden && (
              <Typography variant="caption" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                Your filters hide this entry in the day list.
              </Typography>
            )}
            {nextPlace && (
              <Typography variant="caption" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                {nextPlace.travel
                  ? `${formatTravel(nextPlace.travel)} to ${nextPlace.label}`
                  : `Next: ${nextPlace.label}`}
              </Typography>
            )}
          </Stack>
        </InfoWindow>
      )}
    </>
  );
}

// The day's map: the persistent panel beside the day list (SidebarSlot, when the
// viewport has room), and what a narrower screen's map dialog (DayMapPanel) shows.
// Drawn like the route planner's map (RoutePlannerMap): the plan the reader has picked as a road path in its color,
// every place a numbered ring. Needs the Maps JavaScript API (loaded lazily by
// the APIProvider SidebarSlot or DayMapPanel puts around this component, mounted
// only while the map shows) and a real Map ID
// (GOOGLE_MAPS_MAP_ID) for AdvancedMarker to render at all.
//
// One map, not one per day: DaysView tracks the day the reader is on and swaps
// this same map's pins to match, rather than standing up a separate live
// google.maps.Map instance per day.
export function DayMapSidebar({
  activeDay,
  onRevealed,
}: {
  activeDay: Day | null;
  // A pin's entry just sent the reader to its card in the day list.
  onRevealed?: () => void;
}) {
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
  return <DayMapSidebarContent day={activeDay} onRevealed={onRevealed} />;
}

function DayMapSidebarContent({ day, onRevealed }: { day: Day; onRevealed?: () => void }) {
  const { palette } = useTheme();
  const revealCard = useRevealCard(day.date);
  const reveal = (ref: DayMapPlaceRef) => {
    const shown = revealCard(ref);
    if (shown) onRevealed?.();
    return shown;
  };
  // The nodes of the plan the reader has picked, one per chronological occurrence
  // of a place (a round-trip Transit's shared from/to needs two nodes, one marker).
  const routeNodes = useMemo(() => mapRouteNodes(day.visits), [day.visits]);
  const numberedStops = useMemo(() => numberedMapStops(day.visits), [day.visits]);
  const stops = useMemo(() => numberedStops.map(({ stop }) => stop), [numberedStops]);
  // The route planner's line color for the picked plan: the ideal plan's first.
  const picked = activeTrackOf(day.scenarioTracks)?.scenario;
  const color = planColor(palette.routeVariants, day.scenarioTracks);
  // dedupeDayMapPlaceStops only adds a stop once its place has a real Google Place
  // id (see mapRouteNodes), so this cast is safe.
  const coords = usePlaceCoordinates(stops.map((stop) => stop.place.id as string));
  const { data } = useTripData();
  const overrides = data?.travelModeOverrides;
  const segments = useMemo(
    () => buildRouteSegments(routeNodes, coords, overrides ?? []),
    [routeNodes, coords, overrides],
  );
  const routePaths = useRoutePaths(segments);
  const segmentTravelInfo = useSegmentTravelInfo(segments);
  // Numbered along every row of the plan, so a number does not change as the
  // coordinates of the others arrive.
  const shownStops = numberedStops.filter(({ stop }) => coords.has(stop.place.id as string));
  const points = shownStops.map(({ stop }) => coords.get(stop.place.id as string) as Coordinates);
  const pointsKey = shownStops
    .map(({ stop }) => stop.place.id)
    .sort()
    .join(',');
  const legInto = useMemo(() => new Map(segments.map((s) => [s.fromIndex + 1, s])), [segments]);
  const driveMinutes = useMemo(
    () => new Map([...segmentTravelInfo].map(([key, info]) => [key, info.minutes])),
    [segmentTravelInfo],
  );
  const preview = useDayPreview({
    day,
    planId: picked?._id ?? '',
    nodes: routeNodes,
    coords,
    legInto,
    paths: routePaths,
    driveMinutes,
  });
  // The first leg leaving each place — a round-trip day visiting the same place
  // twice has more than one, but a pin only ever needs one "next place" line.
  const nextPlaceByStopId = useMemo(() => {
    const labels = new Map(stops.map((stop) => [stop.place.id as string, stop.place.label]));
    const result = new Map<string, NextPlaceInfo>();
    for (const segment of segments) {
      if (result.has(segment.fromPlaceId)) continue;
      const label = labels.get(segment.toPlaceId);
      if (!label) continue;
      result.set(segment.fromPlaceId, {
        label,
        travel: segmentTravelInfo.get(segment.key) ?? null,
      });
    }
    return result;
  }, [segments, stops, segmentTravelInfo]);

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
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <GoogleMap
        // the narrow screens' dialog unmounts on close, and each new map is billed
        reuseMaps
        mapId={GOOGLE_MAPS_MAP_ID}
        colorScheme={palette.mode === 'dark' ? 'DARK' : 'LIGHT'}
        style={{ width: '100%', height: '100%' }}
        defaultCenter={points[0] ?? { lat: 61.2181, lng: -149.9003 }}
        defaultZoom={9}
        disableDefaultUI
        gestureHandling="greedy"
      >
        <FitBoundsToPoints
          // clear of the Preview day button along the bottom
          padding={FIT_PADDING}
          points={points}
          pointsKey={`${pointsKey}${preview.following ? ':preview' : ''}`}
        />
        {segments.map((segment) => (
          <Polyline
            key={segment.key}
            path={routePaths.get(segment.key) ?? [segment.fromPoint, segment.toPoint]}
            strokeColor={color}
            strokeWeight={6}
          />
        ))}
        {shownStops.map(({ stop, numbers }) => (
          <PlaceMarker
            key={stop.place.id}
            stop={stop}
            label={pinLabel(numbers)}
            color={color}
            active={stop.place.id === preview.activePlaceId}
            coordinates={coords.get(stop.place.id as string) as Coordinates}
            nextPlace={nextPlaceByStopId.get(stop.place.id as string) ?? null}
            onReveal={reveal}
          />
        ))}
        {preview.point && <PreviewMarker point={preview.point} />}
        <MapButtons fitPoints={points} />
      </GoogleMap>
      {!preview.previewing && (
        <Box sx={{ position: 'absolute', left: 12, bottom: 32, zIndex: 2 }}>
          <PreviewStartButton
            label="Preview day"
            reason={preview.resolved ? undefined : PREVIEW_NEEDS_PLACES}
            onClick={preview.start}
          />
        </Box>
      )}
      {preview.previewing && (
        <Box sx={{ position: 'absolute', left: 12, right: 72, bottom: 32, zIndex: 2 }}>
          <PreviewBar
            caption={preview.caption}
            playing={preview.playback.playing}
            progress={preview.playback.progress}
            clock={preview.clock}
            clockTitle="The times on the day's list."
            onPlay={preview.playback.play}
            onPause={preview.playback.pause}
            onSeek={preview.playback.seek}
            onClose={preview.close}
          />
        </Box>
      )}
    </Box>
  );
}
