import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';

import type { Leg } from '../../model/types';

// Asks which leg a moved entry joins: on a day where the trip changes legs, or on a
// day beyond the trip, where the chosen leg grows to reach it. The suggested one is
// marked.
export function LegChoiceDialog({
  open,
  legs,
  title,
  suggestedLegId,
  onChoose,
  onClose,
}: {
  open: boolean;
  legs: Leg[];
  title: string;
  suggestedLegId: string | null;
  onChoose: (legId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <List>
        {legs.map((leg) => (
          <ListItemButton key={leg._id} onClick={() => onChoose(leg._id)}>
            <ListItemText
              primary={leg.name}
              secondary={leg._id === suggestedLegId ? 'Suggested' : undefined}
            />
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
}
