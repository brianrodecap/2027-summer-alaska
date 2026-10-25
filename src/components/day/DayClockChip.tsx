import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

import { dayClocksOf } from '../../model/dayClocks';
import type { Day } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';

// The clock the day is on, beside the date in the sticky header ('AKDT'), or
// every clock it moves through ('MDT → MST'), so a day that crosses a zone line
// says so even collapsed. None on a trip with no zones recorded. A day the
// clocks change on with a place whose zone isn't recorded (its times read on
// the trip's clock) is flagged, with re-picking the place as the way to record it.
export function DayClockChip({ day }: { day: Day }) {
  const { names, changes, unzoned } = dayClocksOf(day);
  if (!names.length) return null;
  const crosses = changes.size > 0;
  // Only where it matters: on a day the clocks change.
  const unknown = crosses ? unzoned : [];
  const tips = [
    crosses ? 'The clocks change today: times show which clock they are on.' : null,
    unknown.length
      ? `No time zone recorded for ${unknown.join(', ')}: their times read on the clock the trip is on at that time. Re-pick each place in its edit form to record its zone.`
      : null,
  ].filter(Boolean);
  const chip = (
    <Chip
      size="small"
      icon={renderMaterialIcon(unknown.length ? 'warning' : 'schedule')}
      label={names.join(' → ')}
      sx={{
        ml: 1,
        bgcolor: crosses ? 'tertiary.container' : 'surfaceContainer.high',
        color: crosses ? 'tertiary.onContainer' : 'text.secondary',
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
  return tips.length ? (
    <Tooltip title={tips.join(' ')} enterTouchDelay={0}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
