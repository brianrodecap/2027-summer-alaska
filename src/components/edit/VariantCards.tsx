import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import { alpha, useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { formatMinutes } from '../../model/formatting';
import type { Coordinates } from '../../model/placeCoordinates';
import {
  doublingBack,
  exampleClock,
  variantColor,
  variantPoints,
  variantSplit,
  variantSummary,
} from '../../model/routePlanner';
import type { Route } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { WarningBadge } from '../shared/WarningBadge';

const AddIcon = materialIcon('add');
const AutoAwesomeIcon = materialIcon('auto_awesome');
const CheckCircleIcon = materialIcon('check_circle');
const VisibilityIcon = materialIcon('visibility');
const VisibilityOffIcon = materialIcon('visibility_off');

// One card per variant to compare them side by side: its kind and label, how long it
// takes and how much longer than the fastest, how much of that is driving and how much
// stopping, distance, stops and the example arrival time. The one being edited is
// outlined in its map color with a check, like the editor panel below it; the others
// keep a plain outline. The eye switches a variant's line off the map. A dashed tile adds a variant and the violet one asks
// the assistant for a scenic one.
export function VariantCards({
  route,
  active,
  coords,
  departure,
  hidden,
  busy,
  onSelect,
  onToggleHidden,
  onAdd,
  onSuggestScenic,
}: {
  route: Route;
  active: number;
  coords: ReadonlyMap<string, Coordinates>;
  departure: number;
  hidden: ReadonlySet<string>;
  busy: boolean;
  onSelect: (index: number) => void;
  onToggleHidden: (variantId: string) => void;
  onAdd: () => void;
  onSuggestScenic: () => void;
}) {
  const { palette } = useTheme();
  const summaries = route.variants.map(variantSummary);
  const fastest = summaries.length ? Math.min(...summaries.map((s) => s.minutes)) : 0;
  const tied = summaries.filter((s) => s.minutes === fastest).length > 1;
  const accent = palette.primary.main;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(2, route.variants.length))}, minmax(0, 1fr))`,
          gap: 1,
        }}
      >
        {route.variants.map((v, i) => {
          const color = variantColor(palette.routeVariants, route.variants, i);
          const { minutes, miles, stops } = summaries[i];
          const { drive } = variantSplit(v);
          const selected = i === active;
          const isFastest = minutes === fastest;
          const off = hidden.has(v.id);
          const backs = doublingBack(variantPoints(route, v, coords)).some(Boolean);
          return (
            <Box
              key={v.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                // a key on the eye button is the button's, not the card's
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              sx={{
                cursor: 'pointer',
                minWidth: 0,
                p: 1.25,
                borderRadius: 2,
                border: 2,
                borderStyle: 'solid',
                borderColor: selected ? color : 'divider',
                bgcolor: 'background.paper',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color }}>
                {selected ? (
                  <CheckCircleIcon sx={{ fontSize: 16 }} />
                ) : (
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
                )}
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, textTransform: 'capitalize', flex: 1 }}
                >
                  {v.tone}
                </Typography>
                <Tooltip title={off ? 'Show on the map' : 'Hide from the map'}>
                  <IconButton
                    size="small"
                    aria-label={off ? 'Show on the map' : 'Hide from the map'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleHidden(v.id);
                    }}
                    sx={{ p: 0.25, color: 'text.secondary' }}
                  >
                    {off ? (
                      <VisibilityOffIcon sx={{ fontSize: 18 }} />
                    ) : (
                      <VisibilityIcon sx={{ fontSize: 18 }} />
                    )}
                  </IconButton>
                </Tooltip>
              </Box>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  minHeight: '2.6em',
                }}
              >
                {v.label || 'Untitled'}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {formatMinutes(minutes)}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 22 }}>
                {route.variants.length > 1 && (
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: isFastest ? color : 'text.secondary' }}
                  >
                    {isFastest
                      ? tied
                        ? 'Same time'
                        : 'Fastest'
                      : `+${formatMinutes(minutes - fastest)}`}
                  </Typography>
                )}
                {backs && <WarningBadge title="Doubles back" />}
              </Box>
              <Tooltip title="Solid: driving. Hatched: time at stops.">
                <Box
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    overflow: 'hidden',
                    display: 'flex',
                    bgcolor: alpha(color, 0.18),
                  }}
                >
                  <Box sx={{ width: `${(drive / Math.max(1, minutes)) * 100}%`, bgcolor: color }} />
                  <Box
                    sx={{
                      flex: 1,
                      backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
                    }}
                  />
                </Box>
              </Tooltip>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {miles} mi · {stops} {stops === 1 ? 'stop' : 'stops'} ·{' '}
                {exampleClock(minutes, departure).toLowerCase()}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <ButtonBase
          aria-label="Add a variant"
          onClick={onAdd}
          sx={{
            flex: 1,
            height: 44,
            gap: 0.5,
            borderRadius: 2,
            border: 2,
            borderStyle: 'dashed',
            borderColor: alpha(palette.primary.main, 0.6),
            color: 'primary.main',
            fontWeight: 700,
          }}
        >
          <AddIcon fontSize="small" /> Variant
        </ButtonBase>
        <Tooltip title="Ask the assistant for a scenic variant">
          <span>
            <ButtonBase
              aria-label="Suggest a scenic variant"
              disabled={busy}
              onClick={onSuggestScenic}
              sx={{
                width: 56,
                height: 44,
                borderRadius: 2,
                border: 2,
                borderStyle: 'solid',
                borderColor: accent,
                color: accent,
                '&.Mui-disabled': { opacity: 0.5 },
              }}
            >
              <AutoAwesomeIcon />
            </ButtonBase>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
