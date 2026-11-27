import Chip from '@mui/material/Chip';

import { portCallDayLabel, portCallIcon } from '../../model/entityDetails';
import { portCallsOn } from '../../model/tripModel';
import type { Day } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';

// The ship's stop on a cruise day (from the day's own stays — the cabin's
// port calls) — the port and its hours, with all aboard
// as the end — beside the date in the sticky header, so the window a day's
// shore plans must fit is in view even with the day collapsed. Activities
// ashore outside it are flagged on their own rows (portCallWarningFor).
export function DayPortCallChip({ day }: { day: Day }) {
  const calls = portCallsOn(day.stays, day.date);
  return (
    <>
      {calls.map((call, i) => (
        <Chip
          key={`${i}-${call.place.label}-${call.arrivesAt}-${call.departsAt}`}
          size="small"
          icon={renderMaterialIcon(portCallIcon(call.kind))}
          label={portCallDayLabel(call, day.date)}
          sx={{
            ml: 1,
            bgcolor: 'primary.container',
            color: 'primary.onContainer',
            '& .MuiChip-icon': { color: 'primary.onContainer' },
          }}
        />
      ))}
    </>
  );
}
