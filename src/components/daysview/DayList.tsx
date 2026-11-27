import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Day } from '../../model/types';
import { DayAccordion } from '../day/DayAccordion';
import { DayListDnd } from './DayListDnd';

// One collapsible block per visible day, inside the drag-and-drop context —
// or a note when the active filters leave no day to show.
export function DayList({
  days,
  onOpenMap,
  onAddEvent,
  poster,
}: {
  days: Day[];
  onOpenMap: (day: Day) => void;
  onAddEvent: (day: Day) => void;
  poster?: { tripStart: string | null };
}) {
  if (days.length === 0) {
    return (
      <Typography variant="body1" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
        No days match the selected filters.
      </Typography>
    );
  }
  return (
    <DayListDnd>
      <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
        {days.map((day) => (
          <DayAccordion
            key={day.date}
            day={day}
            onOpenMap={onOpenMap}
            onAddEvent={onAddEvent}
            poster={poster}
          />
        ))}
      </Stack>
    </DayListDnd>
  );
}
