import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { formatTravelerUsage, mergeTravelers, travelerUsage } from '../../model/travelers';
import type { Traveler } from '../../model/types';
import { useTripData } from '../../state/useTripData';
import { materialIcon } from '../shared/materialIcon';

const MergeIcon = materialIcon('call_merge');

const label = (t: Traveler) => (t.age != null ? `${t.name}, ${t.age}` : t.name);

// The trip's travelers, with a way to merge two that are really one person —
// usually someone a document import added because the document spelled an
// existing traveler's name its own way (see model/travelers.ts). One dialog,
// two views: the list, and the merge step for whichever traveler was picked,
// which spells out what moves before anything is committed. The merge goes
// through setData, so the hero's Undo reverts it in one step.
export function TravelersDialog({ onClose }: { onClose: () => void }) {
  const { data, setData } = useTripData();
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [keepId, setKeepId] = useState('');
  // Recounted only when the trip changes, not on every render of the dialog.
  const usageLabels = useMemo(
    () =>
      new Map(
        data
          ? data.trip.travelers.map((t) => [t.id, formatTravelerUsage(travelerUsage(data, t.id))])
          : [],
      ),
    [data],
  );
  if (!data) return null;

  const travelers = data.trip.travelers;
  const merging = travelers.find((t) => t.id === mergingId);
  const others = travelers
    .filter((t) => t.id !== mergingId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const keep = others.find((t) => t.id === keepId);

  const startMerge = (id: string) => {
    setMergingId(id);
    setKeepId('');
  };
  const handleMerge = () => {
    if (!merging || !keep) return;
    setData((prev) => mergeTravelers(prev, keep.id, merging.id));
    setMergingId(null);
  };

  if (merging) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>Merge {merging.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {usageLabels.get(merging.id)}
          </Typography>
          <TextField
            select
            fullWidth
            label="Same person as"
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
          >
            {others.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {label(t)}
              </MenuItem>
            ))}
          </TextField>
          {keep && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Everything that names {merging.name} will name {keep.name} instead, and {merging.name}{' '}
              will be removed from the trip. {keep.name} keeps their own name and seat wherever both
              had one.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergingId(null)}>Back</Button>
          <Button variant="contained" disabled={!keep} onClick={handleMerge}>
            Merge
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Travelers</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List>
          {travelers.map((t) => (
            <ListItem
              key={t.id}
              secondaryAction={
                travelers.length > 1 && (
                  <Tooltip title="Merge into another traveler">
                    <IconButton
                      edge="end"
                      aria-label={`Merge ${t.name} into another traveler`}
                      onClick={() => startMerge(t.id)}
                    >
                      <MergeIcon />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              <ListItemText primary={label(t)} secondary={usageLabels.get(t.id)} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
