import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';

import { fetchFirstPlaceImage, type PlaceSearchResult } from '../../model/places';
import type { Place } from '../../model/types';
import { usePlaceSearch } from './usePlaceSearch';

// A place's Name field doubles as its own type-ahead search box, since
// nobody actually knows a Google Place ID by heart — MUI's Autocomplete
// supplies the dropdown chrome, keyboard nav, and loading spinner that the
// old app's hand-rolled debounce/dropdown-render code used to build itself;
// usePlaceSearch (above) covers only what Autocomplete doesn't: debouncing,
// a minimum query length, and race-condition guarding. The Place ID itself
// is never shown or hand-editable anywhere in the app — a search pick is the
// only way to set one, so a bad match has to be fixed by searching again,
// not by typing a raw id.
export function PlacePickerField({
  label = 'Name',
  place,
  onChange,
  onPicked,
}: {
  label?: string;
  place: Place | null;
  onChange: (place: Place | null) => void;
  // May return a Promise (RouteEditForm's does, to drive its own async
  // recompute) — the photo backfill below always awaits it first, so its
  // own onChange (built from a place snapshot with no images) can never
  // land after and wipe out the photo this field just backfilled.
  onPicked?: (result: PlaceSearchResult) => void | Promise<void>;
}) {
  // Driven straight off `place` rather than mirrored into its own useState —
  // a list of these (a Route variant's places[], say) can have an entry
  // deleted out from under a given index, and React reuses that index's
  // component instance for whichever entry shifted into it; a separate echo
  // of `place.label` initialized only on mount would keep showing the
  // deleted entry's text instead of picking up the shifted-in entry's.
  const inputValue = place?.label ?? '';
  const { options, loading, error } = usePlaceSearch(inputValue);

  // Read at pick-fetch-resolution time rather than closed over from the pick
  // itself — `onChange`'s own synchronous call already moves the parent on
  // to the newly picked place, and this field can go on to something else
  // (the user picks again, or — per the inputValue comment above — this
  // component instance gets reused for a different list entry entirely)
  // before the photo lookup below finishes.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  return (
    <Stack spacing={1}>
      <Autocomplete<PlaceSearchResult, false, false, true>
        freeSolo
        fullWidth
        options={options}
        loading={loading}
        filterOptions={(x) => x} // results are already server-filtered by query
        inputValue={inputValue}
        onInputChange={(_, value) => {
          onChange(value ? { ...place, id: place?.id ?? null, label: value } : null);
        }}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <li key={key} {...rest}>
              <Stack>
                <Typography variant="body2">{option.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.address}
                </Typography>
              </Stack>
            </li>
          );
        }}
        onChange={async (_, value) => {
          if (value && typeof value !== 'string') {
            // A fresh pick names a different physical place than whatever
            // `place` pointed at before, so any images it carried over from
            // that old place are dropped here rather than spread forward —
            // the backfill below (or a later manual hero pick) is what
            // supplies this new place's own image instead.
            onChange({ ...place, id: value.id, label: value.label, images: undefined });
            // Kicked off now (it only needs value.id) but not awaited until
            // after onPicked below, so the two network calls overlap instead
            // of stacking — onPicked's own onChange still lands first; see
            // its doc comment above for why that ordering matters.
            const imagePromise = fetchFirstPlaceImage(value.id);
            await onPicked?.(value);
            const image = await imagePromise;
            if (!image || placeRef.current?.id !== value.id) return;
            onChange({ ...placeRef.current, images: [image] });
          }
        }}
        noOptionsText={error ? 'Search failed — check the Places API key/quota.' : 'No matches.'}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={16} /> : null}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
    </Stack>
  );
}
