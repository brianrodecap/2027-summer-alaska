import WarningIcon from '@mui/icons-material/Warning';
import Tooltip from '@mui/material/Tooltip';

// A small error-toned flag for "this list row's data looks incomplete",
// used inline next to a ListItemText's label (see RoutesDialog/ScenariosDialog).
export function WarningBadge({ title }: { title: string }) {
  return (
    <Tooltip title={title}>
      <WarningIcon fontSize="small" sx={{ color: 'error.main' }} />
    </Tooltip>
  );
}
