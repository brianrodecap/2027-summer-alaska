import WarningIcon from '@mui/icons-material/Warning';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { EnrichedActivity } from '../../model/types';

// Set on an Activity (tripModel.ts's transitOverlapFor/activityOverlapFor)
// whenever its startAt falls inside some Transit's own departsAt–arrivesAt
// span, or inside another Activity's own timed span — a real stop belongs on
// the Route as a waypoint instead of overlapping a Transit, and a meal that
// genuinely happens during another Activity belongs modeled as diningFormat
// 'included-with-activity' instead of overlapping it — so either renders as
// a visible, error-toned flag on the row rather than passing silently. Both
// can be present at once (rare), so each renders its own line.
export function OverlapWarnings({
  activity,
}: {
  activity: Pick<EnrichedActivity, 'transitOverlapWarning' | 'activityOverlapWarning'>;
}) {
  const messages = [activity.transitOverlapWarning, activity.activityOverlapWarning].filter(
    (m): m is string => Boolean(m),
  );
  if (!messages.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      {messages.map((message) => (
        <Stack
          key={message}
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', color: 'error.main' }}
        >
          <WarningIcon fontSize="small" />
          <Typography variant="caption" color="inherit">
            {message}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
