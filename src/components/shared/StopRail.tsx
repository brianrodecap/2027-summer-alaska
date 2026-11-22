import Box from '@mui/material/Box';
import { type Theme, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { formatTravel } from '../../model/formatting';
import type { RouteTravel } from '../../model/types';
import { WarningBadge } from './WarningBadge';

export const STOP_NODE_SIZE = 26;

// The gap between a rail row's node and its text.
export const STOP_ROW_GAP = 1.5;

// Where a rail row's text starts: past the node and the row's gap.
export const STOP_TEXT_INDENT = (theme: Theme) =>
  `calc(${STOP_NODE_SIZE}px + ${theme.spacing(STOP_ROW_GAP)})`;

// A round marker on the spine: a letter for an end, a number for a waypoint, nothing
// (an open ring) for a via.
export function StopNode({
  glyph,
  color,
  filled,
}: {
  glyph: string;
  color: string;
  filled?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <Box
      sx={{
        width: STOP_NODE_SIZE,
        height: STOP_NODE_SIZE,
        borderRadius: '50%',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        border: 3,
        borderStyle: 'solid',
        borderColor: color,
        bgcolor: filled ? color : 'background.paper',
        color: filled ? palette.getContrastText(color) : 'text.primary',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {glyph}
    </Box>
  );
}

// The spine the nodes sit on, from the start to the end and no further. Drawn inside a
// relatively positioned box that holds the rail's rows.
export function RailSpine({ color }: { color: string }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: STOP_NODE_SIZE / 2 - 1.5,
        top: STOP_NODE_SIZE / 2,
        bottom: STOP_NODE_SIZE / 2,
        width: 3,
        bgcolor: color,
        opacity: 0.5,
      }}
    />
  );
}

// A leg's drive time and distance, with a flag where it heads away from the end.
export function LegCaption({ travel, back }: { travel: RouteTravel; back: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: STOP_TEXT_INDENT,
        py: 0.75,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {formatTravel(travel)}
      </Typography>
      {back && <WarningBadge title="Doubles back" />}
    </Box>
  );
}

// One end of the drive: where it starts or finishes, and the example clock time.
export function EndRow({
  glyph,
  name,
  clock,
  color,
}: {
  glyph: string;
  name: string;
  clock: string;
  color: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: STOP_ROW_GAP }}>
      <StopNode glyph={glyph} color={color} filled />
      <Typography variant="body1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {clock}
      </Typography>
    </Box>
  );
}
