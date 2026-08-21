import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import MapIcon from '@mui/icons-material/Map';

import { NotesCluster } from '../shared/Notes';
import { DayTimeline } from './DayTimeline';
import type { Day, EnrichedActivity, EnrichedMealOption, EnrichedStay, EnrichedTransit } from '../../model/types';

// One <section> per Day with a sticky header (date + title) and its full
// Stay/Transit/Activity detail rendered inline underneath — position: sticky
// within its own block, so it stays pinned to the top of the viewport while
// that day's content scrolls past, then hands off to the next day's header
// the moment this one's block scrolls out of view.
export function DayBlock({
  day,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
  onOpenMap,
}: {
  day: Day;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
  onOpenMap: (day: Day) => void;
}) {
  return (
    <Box component="section" id={`day-${day.date}`} sx={{ scrollMarginTop: '4.5rem' }}>
      <Box
        sx={{
          position: 'sticky',
          top: '4rem',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'background.default',
          py: 1,
          px: 3,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            {day.dateLabel}
          </Typography>
          <Typography variant="h6">{day.title}</Typography>
        </Box>
        <IconButton aria-label={`Map for ${day.dateLabel}`} onClick={() => onOpenMap(day)}>
          <MapIcon />
        </IconButton>
      </Box>
      <Box sx={{ px: 3, py: 2 }}>
        <NotesCluster notes={day.notes} />
        <DayTimeline
          day={day}
          sequence={day.sequence}
          daysByDate={daysByDate}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
        />
      </Box>
    </Box>
  );
}
