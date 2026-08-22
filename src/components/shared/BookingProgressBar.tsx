import LinearProgress from '@mui/material/LinearProgress';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import type { BookingProgress } from '../../model/types';

// Same success/default/error roles BookingChip already uses for a single
// Booking, extended with 'warning' for the partial state a rollup can reach
// that a single booking never can.
const PROGRESS_COLOR_ROLE: Record<BookingProgress, 'success' | 'warning' | 'text.disabled'> = {
  booked: 'success',
  partial: 'warning',
  unplanned: 'text.disabled',
};

// A horizontal progress bar showing what percent of a Trip's or Leg's
// bookable leaf entities (Stay/Transit/Activity/Package — see
// tripModel.ts's legBookingPercent/tripBookingPercent) are booked. The
// bar's color reflects the same booked/partial/unplanned rollup as the
// percentage itself, so the two never disagree.
export function BookingProgressBar({
  percent,
  progress,
  width = 72,
}: {
  percent: number;
  progress: BookingProgress;
  width?: number;
}) {
  const theme = useTheme();
  const role = PROGRESS_COLOR_ROLE[progress];
  const barColor =
    role === 'text.disabled' ? theme.palette.text.disabled : theme.palette[role].main;

  return (
    <Tooltip title={`${percent}% booked`} enterTouchDelay={0}>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          width,
          height: 6,
          borderRadius: 3,
          bgcolor: theme.palette.surfaceContainer.high,
          '& .MuiLinearProgress-bar': { bgcolor: barColor, borderRadius: 3 },
        }}
      />
    </Tooltip>
  );
}
