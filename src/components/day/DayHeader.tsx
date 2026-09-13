import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Day } from '../../model/types';
import { DayHolidayChip } from './DayHolidayChip';

// The day accordion's own AccordionSummary content — just the date label,
// holiday chip, and title. No collapsed one-line summary: DayAccordion's
// AccordionSummary already stays visible (and, via position:sticky, pinned)
// whether or not the day is expanded, so there's nothing else that needs
// restating while collapsed. `expanded` only affects whether a long title
// truncates to one line (collapsed) or wraps (expanded), same as before.
export function DayHeader({
  day,
  title,
  expanded,
}: {
  day: Day;
  title: string;
  expanded: boolean;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {day.dateLabel}
        </Typography>
        <DayHolidayChip date={day.date} />
      </Box>
      <Typography variant="h6" noWrap={!expanded}>
        {title}
      </Typography>
    </Box>
  );
}
