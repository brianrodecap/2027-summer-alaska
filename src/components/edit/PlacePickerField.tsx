import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { PlaceSearchResult } from '../../model/places';
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
  onPicked?: (result: PlaceSearchResult) => void;
}) {
  const [inputValue, setInputValue] = useState(place?.label ?? '');
  const { options, loading, error } = usePlaceSearch(inputValue);

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
          setInputValue(value);
          onChange(value ? { id: place?.id ?? null, label: value, images: place?.images } : null);
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
        onChange={(_, value) => {
          if (value && typeof value !== 'string') {
            setInputValue(value.label);
            onChange({ id: value.id, label: value.label, images: place?.images });
            onPicked?.(value);
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
