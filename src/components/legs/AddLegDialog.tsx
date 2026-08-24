import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { applyLegForm, blankLegForm } from '../../model/editForms';
import { AUTHORITY_OPTIONS } from '../../model/formatting';
import type { Leg } from '../../model/types';

// Overview's own "Add leg" — mirrors AddTripDialog's Save/Cancel shape, but
// (unlike Add trip) it saves through the already-open trip's own EditContext
// data flow: Save appends to data.legs via setData and marks 'legs' dirty,
// the same as every other create in this app, rather than downloading a new
// file set. No date fields here — a Leg's span is computed from whatever
// Stay/Transit/Activity ends up pointing at it (tripModel.ts's
// legDateRange), so a brand-new Leg simply shows no dates until its first
// entity is added.
export function AddLegDialog({
  tripId,
  onClose,
  onCreate,
}: {
  tripId: string;
  onClose: () => void;
  onCreate: (leg: Leg) => void;
}) {
  const [form, setForm] = useState(() => blankLegForm());
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const result = applyLegForm(form, tripId);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    onCreate(result.leg);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add leg</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            fullWidth
            autoFocus
          />
          <TextField
            select
            label="Skeleton authority"
            value={form.skeletonAuthority}
            helperText={AUTHORITY_OPTIONS.find((o) => o.value === form.skeletonAuthority)?.helper}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                skeletonAuthority: e.target.value as Leg['skeletonAuthority'],
              }))
            }
          >
            {AUTHORITY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
