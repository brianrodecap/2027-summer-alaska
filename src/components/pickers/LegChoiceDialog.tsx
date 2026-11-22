import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';

import type { Leg } from '../../model/types';

// Asks which leg a moved entry joins, on a day where the trip changes legs. The
// suggested one (its own leg, when that leg claims the day) is marked.
export function LegChoiceDialog({
  open,
  legs,
  suggestedLegId,
  onChoose,
  onClose,
}: {
  open: boolean;
  legs: Leg[];
  suggestedLegId: string | null;
  onChoose: (legId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>The trip changes legs that day. Which leg?</DialogTitle>
      <List>
        {legs.map((leg) => (
          <ListItemButton key={leg._id} onClick={() => onChoose(leg._id)}>
            <ListItemText
              primary={leg.name}
              secondary={leg._id === suggestedLegId ? 'Where it is now' : undefined}
            />
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
}
