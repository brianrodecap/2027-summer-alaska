import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Day } from '../../model/types';
import { DayClockChip } from './DayClockChip';
import { DayHolidayChip } from './DayHolidayChip';
import { DayPortCallChip } from './DayPortCallChip';
import { DayTitleField } from './DayTitleField';

// The day accordion's own AccordionSummary content — just the date label,
// holiday and port-call chips, and title. No collapsed one-line summary: DayAccordion's
// AccordionSummary already stays visible (and, via position:sticky, pinned)
// whether or not the day is expanded, so there's nothing else that needs
// restating while collapsed. `expanded` only affects whether a long title
// truncates to one line (collapsed) or wraps (expanded), same as before.
// With the day poster above (`poster`), it carries the date and the title, and this is
// just the chips.
export function DayHeader({
  day,
  expanded,
  poster = false,
}: {
  day: Day;
  expanded: boolean;
  poster?: boolean;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        {!poster && (
          <Typography variant="caption" color="text.secondary">
            {day.dateLabel}
          </Typography>
        )}
        <DayClockChip day={day} />
        <DayHolidayChip date={day.date} />
        <DayPortCallChip day={day} />
      </Box>
      {!poster && <DayTitleField day={day} expanded={expanded} />}
    </Box>
  );
}
