import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';

import { materialIcon } from './materialIcon';

const PlayArrowIcon = materialIcon('play_arrow');

// The map's "Preview ..." button, as the route planner draws it: a pill over the
// map's bottom-left. `reason` says why it is off while it is.
export function PreviewStartButton({
  label,
  reason,
  onClick,
}: {
  label: string;
  reason?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip title={reason ?? ''}>
      <span>
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          disabled={reason !== undefined}
          onClick={onClick}
          sx={{ borderRadius: 8, px: 3, boxShadow: 4 }}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}
