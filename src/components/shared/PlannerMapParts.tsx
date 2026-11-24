import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import { alpha, useTheme } from '@mui/material/styles';
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { type Ref, useEffect, useState } from 'react';

import type { Coordinates } from '../../model/placeCoordinates';
import { materialIcon } from './materialIcon';

// The pieces the route planner's map and the day map share, so the two look alike.

const AddIcon = materialIcon('add');
const FitScreenIcon = materialIcon('fit_screen');
const RemoveIcon = materialIcon('remove');

// Wide enough that the map's tiles keep up with the camera at preview speed.
const PREVIEW_ZOOM = 9;

const RING = 22;

// Text a screen reader reads that nobody sees.
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

// A ring on a point, in a line's color: filled for an end or the stop a preview is
// at, an open ring for a via. `glyph` is what is inside it. Its name shows beside it
// while the pointer is over it, once it is tapped (when tapping does nothing else),
// and while a preview is stopped there; never otherwise, so rings never crowd out
// each other's names.
export function RingMarker({
  position,
  color,
  glyph,
  name,
  via = false,
  filled = false,
  active = false,
  onClick,
  markerRef,
}: {
  position: Coordinates;
  color: string;
  glyph: string;
  name: string;
  via?: boolean;
  filled?: boolean;
  active?: boolean;
  onClick?: () => void;
  markerRef?: Ref<google.maps.marker.AdvancedMarkerElement>;
}) {
  const { palette } = useTheme();
  const size = via ? 12 : active ? RING + 8 : RING;
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const named = name !== '' && (hovered || tapped || active);
  return (
    <AdvancedMarker
      ref={markerRef}
      position={position}
      zIndex={named ? 8 : active ? 6 : filled ? 5 : 4}
      onClick={onClick ?? (() => setTapped((t) => !t))}
    >
      {/* a marker sits on its point by its bottom edge; this centers the ring on it */}
      <Box
        // a mouse only: a touch's own tap is what toggles the name
        onPointerEnter={(e) => setHovered(e.pointerType === 'mouse')}
        onPointerLeave={() => setHovered(false)}
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
            borderColor: color,
            bgcolor: filled || active ? color : 'background.paper',
            color: filled || active ? palette.getContrastText(color) : 'text.primary',
            boxShadow: active ? `0 0 0 4px ${alpha(color, 0.33)}` : undefined,
            cursor: 'pointer',
          }}
        >
          {via ? null : glyph}
          <span style={VISUALLY_HIDDEN}>{name}</span>
        </Box>
        {named && (
          <Paper
            elevation={3}
            component="span"
            sx={{
              position: 'absolute',
              left: size + 6,
              top: '50%',
              transform: 'translateY(-50%)',
              px: 1,
              py: 0.25,
              whiteSpace: 'nowrap',
              fontSize: 13,
              fontWeight: 700,
              pointerEvents: 'none',
            }}
          >
            {glyph ? `${glyph} · ${name}` : name}
          </Paper>
        )}
      </Box>
    </AdvancedMarker>
  );
}

// Zoom in and out, and frame the whole route again.
export function MapButtons({ fitPoints }: { fitPoints: Coordinates[] }) {
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

// The preview's moving dot, with the camera held on it: zoomed in once, then moved
// in the same frame as the dot (not animated toward it, which lags), so the reader
// can still zoom or pan between frames.
export function PreviewMarker({ point }: { point: Coordinates }) {
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
