import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import WarningIcon from '@mui/icons-material/Warning';

import type { EnrichedActivity } from '../../model/types';

// Set on an Activity (tripModel.ts's transitOverlapFor) whenever its startAt
// falls inside some Transit's own departsAt–arrivesAt span — a real stop
// belongs on the Route as a waypoint instead, so this renders as a visible,
// error-toned flag on the row rather than passing silently.
export function TransitOverlapWarning({ activity }: { activity: Pick<EnrichedActivity, 'transitOverlapWarning'> }) {
  if (!activity.transitOverlapWarning) return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'error.main', mt: 0.5 }}>
      <WarningIcon fontSize="small" />
      <Typography variant="caption" color="inherit">
        {activity.transitOverlapWarning}
      </Typography>
    </Stack>
  );
}
