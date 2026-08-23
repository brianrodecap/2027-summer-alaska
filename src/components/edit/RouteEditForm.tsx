import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { lookupDriveInfo } from '../../model/directions';
import { swapItems as swap } from '../../model/editForms';
import type { Route, RoutePlaceEntry, RouteVariant } from '../../model/types';
import { PlacePickerField } from './PlacePickerField';

const ROUTE_TONE_OPTIONS = [
  { value: 'direct', label: 'Direct' },
  { value: 'scenic', label: 'Scenic' },
];

// 'waypoint' — a real, individually-resolvable stop worth calling out —
// or 'via' — a point that exists only to steer Directions off its default
// path, with no stop of its own. Never a third value; see
// route-places-kind-waypoint-vs-via.
const PLACE_KIND_OPTIONS: { value: RoutePlaceEntry['kind']; label: string }[] = [
  { value: 'waypoint', label: 'Waypoint — a real stop worth calling out' },
  { value: 'via', label: 'Via — steers routing onto the right road, no stop' },
];

// Formats a computed leg for the form's own read-only display — never fed
// back into the data, just a sanity check on what the last lookup returned.
function formatLeg(minutes: number, miles?: number): string {
  return miles != null ? `~${minutes} min · ${miles} mi` : `~${minutes} min`;
}

// Place ID, durationMinutes/distanceMiles, and finalLegMinutes/finalLegMiles
// are never hand-typed in this form — they're re-derived here from Google's
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
async function recomputeVariant(
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
    return info ? { ...p, durationMinutes: info.minutes, distanceMiles: info.miles } : p;
  });

  return {
    ...variant,
    places,
    finalLegMinutes: finalInfo ? finalInfo.minutes : variant.finalLegMinutes,
    finalLegMiles: finalInfo ? finalInfo.miles : variant.finalLegMiles,
  };
}

export function RouteEditForm({
  form,
  onChange,
}: {
  form: Route;
  onChange: (route: Route) => void;
}) {
  const updateVariant = (index: number, variant: RouteVariant) => {
    onChange({ ...form, variants: form.variants.map((v, i) => (i === index ? variant : v)) });
  };

  // Recomputes every variant's durationMinutes/finalLegMinutes from scratch —
  // used after From/To itself changes, since that shifts the origin every
  // first-place duration (and a places-less variant's finalLegMinutes) is
  // measured from.
  const recomputeAllVariants = async (route: Route) => {
    const updated = await Promise.all(
      route.variants.map((v) => recomputeVariant(v, route.from.id, route.to.id)),
    );
    onChange({ ...route, variants: updated });
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">From</Typography>
      <PlacePickerField
        place={form.from}
        onChange={(place) => onChange({ ...form, from: place ?? { id: null, label: '' } })}
        onPicked={(picked) =>
          recomputeAllVariants({ ...form, from: { id: picked.id, label: picked.label } })
        }
      />
      <Typography variant="subtitle2">To</Typography>
      <PlacePickerField
        place={form.to}
        onChange={(place) => onChange({ ...form, to: place ?? { id: null, label: '' } })}
        onPicked={(picked) =>
          recomputeAllVariants({ ...form, to: { id: picked.id, label: picked.label } })
        }
      />
      <Divider />
      <Typography variant="subtitle2">Variants</Typography>
      {form.variants.map((variant, vi) => (
        <Paper key={vi} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                select
                label="Tone"
                size="small"
                value={variant.tone}
                onChange={(e) => updateVariant(vi, { ...variant, tone: e.target.value })}
                sx={{ minWidth: 130 }}
              >
                {ROUTE_TONE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Label"
                size="small"
                value={variant.label}
                onChange={(e) => updateVariant(vi, { ...variant, label: e.target.value })}
                fullWidth
              />
              <IconButton
                aria-label="Move this variant earlier"
                size="small"
                disabled={vi === 0}
                onClick={() => onChange({ ...form, variants: swap(form.variants, vi, vi - 1) })}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                aria-label="Move this variant later"
                size="small"
                disabled={vi === form.variants.length - 1}
                onClick={() => onChange({ ...form, variants: swap(form.variants, vi, vi + 1) })}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                aria-label="Remove this variant"
                size="small"
                onClick={() =>
                  onChange({ ...form, variants: form.variants.filter((_, i) => i !== vi) })
                }
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Places
            </Typography>
            {variant.places.map((place, pi) => (
              <Paper key={pi} variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Kind"
                    value={place.kind}
                    onChange={(e) => {
                      const kind = e.target.value as RoutePlaceEntry['kind'];
                      const next = variant.places.map((p, i) => (i === pi ? { ...p, kind } : p));
                      updateVariant(vi, { ...variant, places: next });
                    }}
                  >
                    {PLACE_KIND_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <PlacePickerField
                    place={place.place ?? null}
                    onChange={(picked) => {
                      const next = variant.places.map((p, i) =>
                        i === pi ? { ...p, place: picked ?? undefined } : p,
                      );
                      updateVariant(vi, { ...variant, places: next });
                    }}
                    onPicked={async (result) => {
                      const nextPlaces = variant.places.map((p, i) =>
                        i === pi ? { ...p, place: { id: result.id, label: result.label } } : p,
                      );
                      const nextVariant = await recomputeVariant(
                        { ...variant, places: nextPlaces },
                        form.from.id,
                        form.to.id,
                        pi,
                      );
                      updateVariant(vi, nextVariant);
                    }}
                  />
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <TextField
                      label="Note (optional)"
                      size="small"
                      value={place.note ?? ''}
                      onChange={(e) => {
                        const next = variant.places.map((p, i) =>
                          i === pi ? { ...p, note: e.target.value || null } : p,
                        );
                        updateVariant(vi, { ...variant, places: next });
                      }}
                      fullWidth
                    />
                    <IconButton
                      aria-label="Remove this stage"
                      onClick={async () => {
                        const nextVariant = await recomputeVariant(
                          { ...variant, places: variant.places.filter((_, i) => i !== pi) },
                          form.from.id,
                          form.to.id,
                          pi,
                        );
                        updateVariant(vi, nextVariant);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {formatLeg(place.durationMinutes, place.distanceMiles)} from previous stop
                  </Typography>
                </Stack>
              </Paper>
            ))}
            <Button
              size="small"
              onClick={() =>
                updateVariant(vi, {
                  ...variant,
                  places: [
                    ...variant.places,
                    { kind: 'waypoint', place: { id: null, label: '' }, durationMinutes: 0 },
                  ],
                })
              }
            >
              Add place
            </Button>
            <Typography variant="caption" color="text.secondary">
              Final leg to {form.to.label || 'To'}:{' '}
              {formatLeg(variant.finalLegMinutes, variant.finalLegMiles)}
            </Typography>
          </Stack>
        </Paper>
      ))}
      <Button
        onClick={() =>
          onChange({
            ...form,
            variants: [
              ...form.variants,
              { tone: 'direct', label: '', places: [], finalLegMinutes: 0 },
            ],
          })
        }
      >
        Add variant
      </Button>
    </Stack>
  );
}
