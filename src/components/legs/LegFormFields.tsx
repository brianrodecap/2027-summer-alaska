import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import type { LegFormState } from '../../model/editForms';
import { AUTHORITY_OPTIONS } from '../../model/formatting';
import type { Leg } from '../../model/types';

// The Leg name + skeleton-authority fields, shared by AddLegDialog and
// TripEditDialog's inline "Add a leg" — the same two inputs with the same
// authority helper text, which used to be spelled out separately in each.
export function LegFormFields({
  form,
  onChange,
  nameLabel = 'Name',
}: {
  form: LegFormState;
  onChange: (next: LegFormState) => void;
  nameLabel?: string;
}) {
  return (
    <Stack spacing={2} sx={{ mt: 1 }}>
      <TextField
        label={nameLabel}
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
        fullWidth
        autoFocus
      />
      <TextField
        select
        label="Skeleton authority"
        value={form.skeletonAuthority}
        helperText={AUTHORITY_OPTIONS.find((o) => o.value === form.skeletonAuthority)?.helper}
        onChange={(e) =>
          onChange({ ...form, skeletonAuthority: e.target.value as Leg['skeletonAuthority'] })
        }
      >
        {AUTHORITY_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
