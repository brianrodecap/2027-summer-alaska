import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import { AdvancedMarker, Map as GoogleMap, Polyline, useMap } from '@vis.gl/react-google-maps';
import { useEffect, useMemo, useState } from 'react';

import { GOOGLE_MAPS_MAP_ID } from '../../config/places';
import { useSegmentLookup } from '../../hooks/useSegmentLookup';
import { type LatLngPoint, lookupRoutePath } from '../../model/directions';
import type { Coordinates } from '../../model/placeCoordinates';
import {
  type Bounds,
  offsetPath,
  pointOnPath,
  routePoints,
  variantColorIndex,
  variantPlaceIds,
} from '../../model/routePlanner';
import { DEFAULT_ROUTE_TONE } from '../../model/tripModel';
import type { Route, RouteVariant } from '../../model/types';
import { FitBoundsToPoints } from '../shared/FitBoundsToPoints';
import { materialIcon } from '../shared/materialIcon';

const AddIcon = materialIcon('add');
const FitScreenIcon = materialIcon('fit_screen');
const RemoveIcon = materialIcon('remove');

const LINE_GAP_PX = 8;
const DEFAULT_ZOOM = 6;
// Wide enough that the map's tiles keep up with the camera at preview speed.
const PREVIEW_ZOOM = 9;

interface Stop {
  id: string;
  point: Coordinates;
}

// A variant's ends and places in driving order, minus any that have no id or
// no coordinates yet.
function variantStops(
  route: Route,
  variant: RouteVariant,
  coords: ReadonlyMap<string, Coordinates>,
): Stop[] {
  return variantPlaceIds(route, variant).flatMap((id) => {
    const point = id ? coords.get(id) : undefined;
    return id && point ? [{ id, point }] : [];
  });
}

const legKey = (a: Stop, b: Stop) => `${a.id}>${b.id}`;

function useZoom(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  useEffect(() => {
    if (!map) return;
    // idle fires once the map is ready, so the first real zoom arrives without setting state here.
    const update = () => setZoom(map.getZoom() ?? DEFAULT_ZOOM);
    const listeners = [map.addListener('zoom_changed', update), map.addListener('idle', update)];
    return () => listeners.forEach((l) => l.remove());
  }, [map]);
  return zoom;
}

function ReportBounds({ onBounds }: { onBounds: (bounds: Bounds) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('idle', () => {
      const bounds = map.getBounds()?.toJSON();
      if (bounds) onBounds(bounds);
    });
    return () => listener.remove();
  }, [map, onBounds]);
  return null;
}

interface PlannerMapProps {
  routes: Route[];
  coords: ReadonlyMap<string, Coordinates>;
  selectedId: string | null;
  activeVariant: number;
  // Variants (by id) of the selected route the reader has switched off with the eye.
  hidden: ReadonlySet<string>;
  // The other routes whose roads are drawn behind it: the ones in the list.
  backdrop: ReadonlySet<string>;
  // The place of the active variant a preview is stopped at.
  activeStop: number | null;
  onBounds: (bounds: Bounds) => void;
  onSelectRoute: (routeId: string) => void;
  onSelectVariant: (index: number) => void;
  // A proposed order, previewed as a dashed line until it's accepted or discarded.
  ghost?: Coordinates[] | null;
  // A preview in progress on the active variant: the leg being driven (counted in
  // the direction it is driven) and how far along it, or null when there is none.
  preview?: { leg: number; fraction: number; reversed: boolean } | null;
  // A place clicked on the map, by its Google place id and where the click landed.
  onPlaceClick?: (placeId: string, at: Coordinates) => void;
}

// Every route as a faint real road, and the selected one in full: each variant a
// road path in its own color, nudged sideways so variants sharing a road sit side
// by side, with its stops labeled.
export function RoutePlannerMap(props: PlannerMapProps) {
  const { palette } = useTheme();
  return (
    <GoogleMap
      mapId={GOOGLE_MAPS_MAP_ID}
      colorScheme={palette.mode === 'dark' ? 'DARK' : 'LIGHT'}
      style={{ width: '100%', height: '100%' }}
      defaultCenter={{ lat: 62, lng: -149 }}
      defaultZoom={DEFAULT_ZOOM}
      disableDefaultUI
      gestureHandling="greedy"
      onClick={(e) => {
        const { placeId, latLng } = e.detail;
        if (!props.onPlaceClick || !placeId || !latLng) return;
        e.stop(); // not Google's own place card
        props.onPlaceClick(placeId, latLng);
      }}
    >
      <Layers {...props} />
    </GoogleMap>
  );
}

function Layers({
  routes,
  coords,
  selectedId,
  activeVariant,
  hidden,
  backdrop,
  activeStop,
  onBounds,
  onSelectRoute,
  onSelectVariant,
  ghost,
  preview,
}: PlannerMapProps) {
  const { palette } = useTheme();
  const zoom = useZoom();
  const selected = routes.find((r) => r._id === selectedId) ?? null;
  const variants = useMemo(
    () => selected?.variants.map((v) => variantStops(selected, v, coords)) ?? [],
    [selected, coords],
  );
  // The other routes' direct variants, which are drawn faintly behind the selected one.
  const others = useMemo(
    () =>
      routes
        .filter((r) => r._id !== selectedId && backdrop.has(r._id))
        .map((route) => {
          const direct = route.variants.find((v) => v.tone === DEFAULT_ROUTE_TONE);
          return {
            id: route._id,
            stops: direct ? variantStops(route, direct, coords) : [],
          };
        }),
    [routes, coords, selectedId, backdrop],
  );
  const legs = useMemo(() => {
    const byKey = new Map<string, [Stop, Stop]>();
    for (const stops of [...variants, ...others.map((o) => o.stops)])
      stops.slice(1).forEach((to, i) => {
        if (stops[i].id !== to.id) byKey.set(legKey(stops[i], to), [stops[i], to]);
      });
    return [...byKey.entries()];
  }, [variants, others]);
  const paths = useSegmentLookup(
    legs,
    ([key]) => key,
    ([key]) => key,
    ([, [a, b]]) => lookupRoutePath(a.id, b.id, 'DRIVE'),
  ).value;
  // A route's road, or nothing until every leg of it has loaded: a straight line
  // across the country while the roads arrive is worse than a moment of nothing.
  const otherRoads = useMemo(
    () =>
      others.map(({ id, stops }) => {
        const roads = stops.slice(1).flatMap((to, k) => paths.get(legKey(stops[k], to)) ?? []);
        const loaded =
          stops.length > 1 && stops.slice(1).every((to, k) => paths.has(legKey(stops[k], to)));
        return { id, path: loaded ? roads : ([] as LatLngPoint[]) };
      }),
    [others, paths],
  );
  // Each variant's road, nudged sideways; rebuilt when they or the zoom change, not
  // on every preview frame.
  const variantLines = useMemo(
    () =>
      variants.map((stops, i) =>
        offsetPath(
          stops
            .slice(1)
            .flatMap((to, k) => paths.get(legKey(stops[k], to)) ?? [stops[k].point, to.point]),
          (i - (variants.length - 1) / 2) * LINE_GAP_PX,
          zoom,
        ),
      ),
    [variants, paths, zoom],
  );
  // The active variant's road, leg by leg, in the direction a preview runs: worked out
  // when the roads or the direction change, not on every frame.
  const reversed = preview?.reversed ?? false;
  const previewing = !!preview;
  const previewLegs = useMemo(() => {
    const stops = variants[activeVariant];
    if (!previewing || !stops) return [];
    const legs = stops
      .slice(1)
      .map((to, k) => paths.get(legKey(stops[k], to)) ?? [stops[k].point, to.point]);
    return reversed ? legs.reverse().map((leg) => [...leg].reverse()) : legs;
  }, [previewing, reversed, variants, activeVariant, paths]);
  const previewAt =
    preview && previewLegs[preview.leg]
      ? pointOnPath(previewLegs[preview.leg], preview.fraction)
      : null;
  const fitPoints = selected
    ? routePoints(selected, coords)
    : routes.flatMap((r) => routePoints(r, coords));

  return (
    <>
      <FitBoundsToPoints
        points={fitPoints}
        pointsKey={`${selectedId ?? 'all'}:${fitPoints.length}:${preview ? 'preview' : ''}`}
      />
      <ReportBounds onBounds={onBounds} />
      {otherRoads.map(({ id, path }) =>
        path.length ? (
          <Polyline
            key={id}
            path={path}
            strokeColor={palette.text.secondary}
            strokeOpacity={0.45}
            strokeWeight={3}
            onClick={() => onSelectRoute(id)}
          />
        ) : null,
      )}
      {selected &&
        variantLines.map((path, i) => {
          if (hidden.has(selected.variants[i].id)) return null;
          const active = i === activeVariant;
          return (
            <Polyline
              key={i}
              path={path}
              strokeColor={palette.routeVariants[variantColorIndex(selected.variants, i)]}
              strokeOpacity={active ? 1 : 0.85}
              strokeWeight={active ? 6 : 5}
              zIndex={active ? 2 : 1}
              onClick={() => onSelectVariant(i)}
            />
          );
        })}
      {ghost && (
        <Polyline
          path={ghost}
          strokeOpacity={0}
          zIndex={3}
          icons={[
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 1,
                strokeColor: palette.conditions.moon,
                scale: 3,
              },
              offset: '0',
              repeat: '14px',
            },
          ]}
        />
      )}
      {selected && (
        <StopMarkers
          route={selected}
          variant={activeVariant}
          coords={coords}
          activeStop={activeStop}
        />
      )}
      {previewAt && <PreviewMarker point={previewAt} />}
      <MapButtons fitPoints={fitPoints} />
    </>
  );
}

const RING = 22;

// A and B for the ends, numbers for the active variant's waypoints and a small
// open ring for a via, each with its name beside it.
function StopMarkers({
  route,
  variant,
  coords,
  activeStop,
}: {
  route: Route;
  variant: number;
  coords: ReadonlyMap<string, Coordinates>;
  activeStop: number | null;
}) {
  const { palette } = useTheme();
  const places = route.variants[variant]?.places ?? [];
  let number = 0;
  const pins = [
    {
      key: 'from',
      id: route.from.id,
      glyph: 'A',
      name: route.from.label,
      via: false,
      active: false,
    },
    ...places.map((p, i) => ({
      key: `p${i}`,
      id: p.place?.id ?? null,
      glyph: p.kind === 'waypoint' ? String(++number) : '',
      name: p.label ?? p.place?.label ?? '',
      via: p.kind === 'via',
      active: i === activeStop,
    })),
    { key: 'to', id: route.to.id, glyph: 'B', name: route.to.label, via: false, active: false },
  ];
  return (
    <>
      {pins.map(({ key, id, glyph, name, via, active }) => {
        const position = id ? coords.get(id) : undefined;
        if (!position) return null;
        const size = via ? 12 : active ? RING + 8 : RING;
        const end = key === 'from' || key === 'to';
        const halo = palette.background.default;
        return (
          <AdvancedMarker key={key} position={position} zIndex={active ? 6 : end ? 5 : 4}>
            {/* a marker sits on its point by its bottom edge; this centers the ring on it */}
            <Box
              sx={{ position: 'relative', width: size, height: size, transform: 'translateY(50%)' }}
            >
              <Box
                sx={{
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  border: via ? 2 : 3,
                  borderStyle: 'solid',
                  borderColor: 'primary.main',
                  bgcolor: end || active ? 'primary.main' : 'background.paper',
                  color: end || active ? 'primary.contrastText' : 'text.primary',
                  boxShadow: active ? `0 0 0 4px ${palette.primary.main}55` : undefined,
                }}
              >
                {via ? null : glyph}
              </Box>
              {name && (
                <Box
                  component="span"
                  sx={{
                    position: 'absolute',
                    left: size + 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    fontWeight: via ? 400 : 700,
                    color: 'text.primary',
                    // a halo in the page color keeps the name legible over roads and terrain
                    textShadow: `0 0 3px ${halo}, 0 0 3px ${halo}, 0 0 6px ${halo}`,
                    pointerEvents: 'none',
                  }}
                >
                  {name}
                </Box>
              )}
            </Box>
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// The preview's moving dot, with the camera held on it: zoomed in once, then moved
// in the same frame as the dot (not animated toward it, which lags), so the reader
// can still zoom or pan between frames.
function PreviewMarker({ point }: { point: Coordinates }) {
  const map = useMap();
  const { palette } = useTheme();
  useEffect(() => {
    map?.setZoom(PREVIEW_ZOOM);
  }, [map]);
  useEffect(() => {
    map?.moveCamera({ center: point });
  }, [map, point]);
  return (
    <AdvancedMarker position={point} zIndex={10}>
      <Box
        sx={{
          transform: 'translateY(50%)',
          width: 20,
          height: 20,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          border: `3px solid ${palette.primary.contrastText}`,
          boxShadow: `0 0 0 3px ${palette.primary.dark}`,
        }}
      />
    </AdvancedMarker>
  );
}

// Zoom in and out, and frame the whole route again.
function MapButtons({ fitPoints }: { fitPoints: Coordinates[] }) {
  const map = useMap();
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        right: 12,
        bottom: 32,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
      }}
    >
      <IconButton aria-label="Zoom in" onClick={() => map?.setZoom((map.getZoom() ?? 6) + 1)}>
        <AddIcon />
      </IconButton>
      <IconButton aria-label="Zoom out" onClick={() => map?.setZoom((map.getZoom() ?? 6) - 1)}>
        <RemoveIcon />
      </IconButton>
      <IconButton
        aria-label="Fit the whole route"
        disabled={fitPoints.length < 2}
        onClick={() => {
          const bounds = new google.maps.LatLngBounds();
          fitPoints.forEach((p) => bounds.extend(p));
          map?.fitBounds(bounds, 48);
        }}
      >
        <FitScreenIcon />
      </IconButton>
    </Paper>
  );
}
