import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Day } from '../../model/types';
import { DayHolidayChip } from './DayHolidayChip';
import { DayPortCallChip } from './DayPortCallChip';

// The day accordion's own AccordionSummary content — just the date label,
// holiday and port-call chips, and title. No collapsed one-line summary: DayAccordion's
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
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {day.dateLabel}
        </Typography>
        <DayHolidayChip date={day.date} />
        <DayPortCallChip day={day} />
      </Box>
      <Typography variant="h6" noWrap={!expanded} sx={{ color: 'gold.main' }}>
        {title}
      </Typography>
    </Box>
  );
}
