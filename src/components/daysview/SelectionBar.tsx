import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import { selectionToMove } from '../../model/moveToDay';
import { useMoveToDay } from '../../state/useMoveToDay';
import { useRowSelection } from '../../state/useTripSelections';
import { materialIcon } from '../shared/materialIcon';

const EventIcon = materialIcon('event');

// Shown while rows are selected: what is selected, and the actions that apply
// to all of it.
export function SelectionBar() {
  const { selection, clearRowSelection } = useRowSelection();
  const { requestMove } = useMoveToDay();
  if (!selection || selection.rows.size === 0) return null;

  const moves = selectionToMove([...selection.rows.values()]);
  const count = new Set(moves.flatMap((m) => [...m.activityIds, ...m.transitIds, ...m.stayIds]))
    .size;

  return (
    <Paper
      elevation={6}
      role="region"
      aria-label="Selected items"
      sx={{
        position: 'fixed',
        bottom: 16,
        left: 0,
        right: 0,
        mx: 'auto',
        width: 'max-content',
        maxWidth: 'calc(100% - 32px)',
        zIndex: 'snackbar',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0.75,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
        {count} selected
      </Typography>
      <Button
        size="small"
        startIcon={<EventIcon />}
        sx={{ whiteSpace: 'nowrap' }}
        onClick={() => requestMove(moves, clearRowSelection)}
      >
        Move to day…
      </Button>
      <Button size="small" color="inherit" onClick={clearRowSelection}>
        Clear
      </Button>
    </Paper>
  );
}
