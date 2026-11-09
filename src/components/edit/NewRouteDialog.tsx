import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import { useState } from 'react';

import type { Place } from '../../model/types';
import { PlacePickerField } from './PlacePickerField';

// A route starts as where it begins and where it ends, each searched for like any
// other place; its direct variant is made from them and the stops are added in the
// planner.
export function NewRouteDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (from: Place, to: Place) => void;
}) {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const ready = !!from?.id && !!to?.id && from.id !== to.id;
  const close = () => {
    setFrom(null);
    setTo(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>New route</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <PlacePickerField label="From" place={from} onChange={setFrom} />
          <PlacePickerField label="To" place={to} onChange={setTo} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!ready}
          onClick={() => {
            if (from && to) onCreate(from, to);
            close();
          }}
        >
          Create route
        </Button>
      </DialogActions>
    </Dialog>
  );
}
