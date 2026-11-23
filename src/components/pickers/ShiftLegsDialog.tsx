import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

export interface ShiftedLeg {
  id: string;
  name: string;
  days: number;
}

const inDays = (days: number) =>
  `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days > 0 ? 'later' : 'earlier'}`;

// Offered when a move stretches a leg over another one: shifting the other legs
// keeps the gap they had, leaving them puts the legs on top of each other. Neither
// is wrong; the person decides.
export function ShiftLegsDialog({
  open,
  legs,
  onShift,
  onLeave,
  onCancel,
}: {
  open: boolean;
  legs: ShiftedLeg[];
  onShift: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>This runs into another leg</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Moving there stretches the leg over {legs.length === 1 ? 'another leg' : 'other legs'}.
          Shift {legs.length === 1 ? 'it' : 'them'} to keep the gap, or leave{' '}
          {legs.length === 1 ? 'it' : 'them'} where {legs.length === 1 ? 'it is' : 'they are'} and
          let the legs overlap?
        </DialogContentText>
        <ul>
          {legs.map((leg) => (
            <li key={leg.id}>
              {leg.name}: everything moves {inDays(leg.days)}
            </li>
          ))}
        </ul>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onLeave}>Leave them</Button>
        <Button variant="contained" onClick={onShift}>
          Shift them
        </Button>
      </DialogActions>
    </Dialog>
  );
}
