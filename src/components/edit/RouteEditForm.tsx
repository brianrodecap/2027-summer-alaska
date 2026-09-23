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
import { blankRoutePlaceEntry, blankRouteVariant, swapItems as swap } from '../../model/editForms';
import { formatTravel } from '../../model/formatting';
import {
  DEFAULT_ROUTE_TONE,
  DEFAULT_WAYPOINT_DURATION_MINUTES,
  hasDirectVariant,
} from '../../model/tripModel';
import type { Route, RoutePlaceEntry, RouteVariant } from '../../model/types';
import { PlacePickerField } from './PlacePickerField';

const ROUTE_TONE_OPTIONS = [
  { value: DEFAULT_ROUTE_TONE, label: 'Direct' },
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

// Place ID, each place's travel, and each variant's finalTravel
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

  const updatePlace = (
    vi: number,
    variant: RouteVariant,
    pi: number,
    updater: (place: RoutePlaceEntry) => RoutePlaceEntry,
  ) => {
    updateVariant(vi, {
      ...variant,
      places: variant.places.map((p, i) => (i === pi ? updater(p) : p)),
    });
  };

  // Recomputes every variant's travel/finalTravel from scratch — used after
  // From/To itself changes, since that shifts the origin every first place's
  // travel (and a places-less variant's finalTravel) is measured from.
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
                  <MenuItem
                    key={o.value}
                    value={o.value}
                    // Only one variant can be the direct one (directVariantProblem).
                    disabled={
                      o.value === DEFAULT_ROUTE_TONE &&
                      variant.tone !== DEFAULT_ROUTE_TONE &&
                      hasDirectVariant(form.variants)
                    }
                  >
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
                      // A via has no stop, so it never carries a stop duration.
                      updatePlace(vi, variant, pi, ({ durationMinutes, ...rest }) =>
                        kind === 'waypoint'
                          ? { ...rest, kind, durationMinutes }
                          : { ...rest, kind },
                      );
                    }}
                  >
                    {PLACE_KIND_OPTIONS.map((o) => (
                      <MenuItem
                        key={o.value}
                        value={o.value}
                        // The direct variant is the default path — vias only
                        // steer other variants off it (directVariantProblem).
                        disabled={o.value === 'via' && variant.tone === DEFAULT_ROUTE_TONE}
                      >
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <PlacePickerField
                    place={place.place ?? null}
                    onChange={(picked) => {
                      updatePlace(vi, variant, pi, (p) => ({ ...p, place: picked ?? undefined }));
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
                        const note = e.target.value || null;
                        updatePlace(vi, variant, pi, (p) => ({ ...p, note }));
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
                  {place.kind === 'waypoint' && (
                    <TextField
                      label="Stop duration (minutes)"
                      size="small"
                      type="number"
                      value={place.durationMinutes ?? ''}
                      placeholder={String(DEFAULT_WAYPOINT_DURATION_MINUTES)}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { min: 0, step: 5 },
                      }}
                      helperText={
                        place.durationMinutes === undefined
                          ? `Blank = ${DEFAULT_WAYPOINT_DURATION_MINUTES} minutes`
                          : undefined
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        updatePlace(vi, variant, pi, (p) => {
                          const { durationMinutes: _prev, ...rest } = p;
                          return raw === '' ? rest : { ...rest, durationMinutes: Number(raw) };
                        });
                      }}
                      sx={{ maxWidth: 220 }}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {formatTravel(place.travel)} from previous stop
                  </Typography>
                </Stack>
              </Paper>
            ))}
            <Button
              size="small"
              onClick={() =>
                updateVariant(vi, {
                  ...variant,
                  places: [...variant.places, blankRoutePlaceEntry()],
                })
              }
            >
              Add place
            </Button>
            <Typography variant="caption" color="text.secondary">
              Final leg to {form.to.label || 'To'}: {formatTravel(variant.finalTravel)}
            </Typography>
          </Stack>
        </Paper>
      ))}
      <Button
        onClick={() =>
          onChange({
            ...form,
            variants: [...form.variants, blankRouteVariant(form.variants)],
          })
        }
      >
        Add variant
      </Button>
    </Stack>
  );
}
