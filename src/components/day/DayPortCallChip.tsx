import Chip from '@mui/material/Chip';

import { dateOnly, formatTime, portCallsOn } from '../../model/tripModel';
import type { Day, PortCall } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';

// Only the end(s) of the stop that fall on `date`: an overnight stay reads
// "Arrives 8:00 PM" on its first day and "All aboard 6:00 AM" on its last.
function portCallLabel(call: PortCall, date: string): string {
  const arrivesToday = !!call.arrivesAt && dateOnly(call.arrivesAt) === date;
  const departsToday = !!call.departsAt && dateOnly(call.departsAt) === date;
  const where = call.kind === 'scenic' ? `Cruising past ${call.place.label}` : call.place.label;
  const aboard = call.kind === 'port' ? 'All aboard' : 'Leaves';
  const at = (t: string | null | undefined) => (t ? formatTime(t) : '');
  if (arrivesToday && departsToday) {
    return `${where} · ${at(call.arrivesAt)}–${at(call.departsAt)}${call.kind === 'port' ? ' (all aboard)' : ''}`;
  }
  if (arrivesToday)
    return `${where} · Arrives ${at(call.arrivesAt)}${call.departsAt ? ' · overnight' : ''}`;
  if (departsToday) return `${where} · ${aboard} ${at(call.departsAt)}`;
  return where;
}

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
          icon={renderMaterialIcon('anchor')}
          label={portCallLabel(call, day.date)}
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
