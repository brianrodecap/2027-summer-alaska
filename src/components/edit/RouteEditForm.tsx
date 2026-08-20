import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { PlacePickerField } from './PlacePickerField';
import { lookupDriveMinutes } from '../../model/directions';
import type { Route, RoutePlaceEntry, RouteVariant } from '../../model/types';
import type { PlaceSearchResult } from '../../model/places';

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

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// The Place ID a place entry's own drive time should be measured *from* —
// whichever stop immediately precedes it in the variant's places[] array
// (the authoritative stage order — see route-places-array-order-authoritative),
// or the route's own From when it's the first entry.
function originIdBefore(variant: RouteVariant, placeIndex: number, fromId: string | null): string | null {
  for (let i = placeIndex - 1; i >= 0; i -= 1) {
    const id = variant.places[i].place?.id;
    if (id) return id;
  }
  return fromId;
}

function lastStopId(variant: RouteVariant, fromId: string | null): string | null {
  for (let i = variant.places.length - 1; i >= 0; i -= 1) {
    const id = variant.places[i].place?.id;
    if (id) return id;
  }
  return fromId;
}

// variant.finalLegMinutes is the one drive time places[] never covers on its
// own: from whichever stop comes last (or the route's own From, with none)
// to the route's actual To. Re-measured after anything that could move
// "whichever stop comes last" — a place picked/added/removed, or From/To
// itself repicked. Failure (no drivable route, API not enabled) just leaves
// the field exactly as it was — still hand-editable, the same fallback every
// place picker already has.
async function refreshFinalLeg(variant: RouteVariant, fromId: string | null, toId: string | null): Promise<number> {
  const originId = lastStopId(variant, fromId);
  if (!originId || !toId) return variant.finalLegMinutes;
  try {
    const minutes = await lookupDriveMinutes(originId, toId);
    return minutes ?? variant.finalLegMinutes;
  } catch {
    return variant.finalLegMinutes;
  }
}

export function RouteEditForm({ form, onChange }: { form: Route; onChange: (route: Route) => void }) {
  const updateVariant = (index: number, variant: RouteVariant) => {
    onChange({ ...form, variants: form.variants.map((v, i) => (i === index ? variant : v)) });
  };

  const refreshAllFinalLegs = async (route: Route) => {
    const updated = await Promise.all(
      route.variants.map(async (v) => ({ ...v, finalLegMinutes: await refreshFinalLeg(v, route.from.id, route.to.id) })),
    );
    onChange({ ...route, variants: updated });
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">From</Typography>
      <PlacePickerField
        place={form.from}
        onChange={(place) => onChange({ ...form, from: place ?? { id: null, label: '' } })}
        onPicked={() => refreshAllFinalLegs(form)}
      />
      <Typography variant="subtitle2">To</Typography>
      <PlacePickerField
        place={form.to}
        onChange={(place) => onChange({ ...form, to: place ?? { id: null, label: '' } })}
        onPicked={() => refreshAllFinalLegs(form)}
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
                onClick={() => onChange({ ...form, variants: form.variants.filter((_, i) => i !== vi) })}
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
                      const next = variant.places.map((p, i) => (i === pi ? { ...p, place: picked ?? undefined } : p));
                      updateVariant(vi, { ...variant, places: next });
                    }}
                    onPicked={async (result: PlaceSearchResult) => {
                      const originId = originIdBefore(variant, pi, form.from.id);
                      let durationMinutes = place.durationMinutes;
                      if (originId) {
                        try {
                          const minutes = await lookupDriveMinutes(originId, result.id);
                          if (minutes != null) durationMinutes = minutes;
                        } catch {
                          // leave the duration field alone — still hand-editable.
                        }
                      }
                      const nextPlaces = variant.places.map((p, i) =>
                        i === pi ? { ...p, place: { id: result.id, label: result.label }, durationMinutes } : p,
                      );
                      const nextVariant = { ...variant, places: nextPlaces };
                      const finalLegMinutes = await refreshFinalLeg(nextVariant, form.from.id, form.to.id);
                      updateVariant(vi, { ...nextVariant, finalLegMinutes });
                    }}
                  />
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                    <TextField
                      label="Minutes from previous stop"
                      type="number"
                      size="small"
                      value={place.durationMinutes}
                      onChange={(e) => {
                        const next = variant.places.map((p, i) =>
                          i === pi ? { ...p, durationMinutes: Number(e.target.value) } : p,
                        );
                        updateVariant(vi, { ...variant, places: next });
                      }}
                    />
                    <TextField
                      label="Note (optional)"
                      size="small"
                      value={place.note ?? ''}
                      onChange={(e) => {
                        const next = variant.places.map((p, i) => (i === pi ? { ...p, note: e.target.value || null } : p));
                        updateVariant(vi, { ...variant, places: next });
                      }}
                      fullWidth
                    />
                    <IconButton
                      aria-label="Remove this stage"
                      onClick={async () => {
                        const nextVariant = { ...variant, places: variant.places.filter((_, i) => i !== pi) };
                        const finalLegMinutes = await refreshFinalLeg(nextVariant, form.from.id, form.to.id);
                        updateVariant(vi, { ...nextVariant, finalLegMinutes });
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              </Paper>
            ))}
            <Button
              size="small"
              onClick={() =>
                updateVariant(vi, {
                  ...variant,
                  places: [...variant.places, { kind: 'waypoint', place: { id: null, label: '' }, durationMinutes: 0 }],
                })
              }
            >
              Add place
            </Button>
            <TextField
              label="Final leg — minutes from the last stop to the route's To"
              type="number"
              size="small"
              value={variant.finalLegMinutes}
              onChange={(e) => updateVariant(vi, { ...variant, finalLegMinutes: Number(e.target.value) })}
            />
          </Stack>
        </Paper>
      ))}
      <Button
        onClick={() => onChange({ ...form, variants: [...form.variants, { tone: 'direct', label: '', places: [], finalLegMinutes: 0 }] })}
      >
        Add variant
      </Button>
    </Stack>
  );
}
