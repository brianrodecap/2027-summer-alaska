import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import Accordion from '@mui/material/Accordion';
import AccordionActions from '@mui/material/AccordionActions';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { memo, useState } from 'react';

import type { Day } from '../../model/types';
import { useNoteEdit } from '../../state/useNoteEdit';
import { DEFAULT_NOTE_KIND } from '../shared/noteKind';
import { NotesCluster } from '../shared/Notes';
import { DayAlertsBanner } from './DayAlertsBanner';
import { DayHeader } from './DayHeader';
import { DayInfoStrip } from './DayInfoStrip';
import { DAY_SCROLL_GAP, dayElementId, DAYS_APP_BAR_HEIGHT } from './dayLayout';
import { DayMenu } from './DayMenu';
import { DayPoster } from './DayPoster';
import { DayTimeline } from './DayTimeline';
import { DayTravelChip } from './DayTravelChip';
import { DayWeatherChips } from './DayWeatherChips';
import { useInViewport } from './useInViewport';

// One of the accordion's own two AccordionActions — lets a day that's
// missing something (a meal, a leg of a drive, a place to sleep, a
// weather-branch) grow a new entry right where it belongs, instead of only
// ever editing what's already there. Launches the guided AddEventWizard
// directly rather than a menu of entity kinds — "what are you adding?" is
// the wizard's own first question now, not something this button has to
// ask up front.
function AddToDayButton({ day, onAdd }: { day: Day; onAdd: (day: Day) => void }) {
  return (
    <Button
      startIcon={<AddIcon />}
      onClick={() => onAdd(day)}
      data-testid={`add-to-day-${day.date}`}
    >
      Add to this day
    </Button>
  );
}

// The accordion's other AccordionAction — a day-level note concerns the
// whole date (concerns: [{ date }]) rather than any one Stay/Transit/
// Activity row — see tripModel's notesForDay and NotesCluster's rendering
// of day.notes above the timeline.
function AddNoteButton({ date, dateLabel }: { date: string; dateLabel: string }) {
  const { openNoteCreate } = useNoteEdit();
  return (
    <Button
      startIcon={<NoteAddIcon />}
      onClick={() => openNoteCreate({ date }, DEFAULT_NOTE_KIND)}
      aria-label={`Add a note for ${dateLabel}`}
      data-testid={`add-note-${date}`}
    >
      Add note
    </Button>
  );
}

// One MUI Accordion per Day — AccordionSummary (date/title, the live
// weather/travel info strip) stays sticky at the top of the viewport while
// that day's own AccordionDetails (notes, the full timeline) scrolls past,
// then hands off to the next day's summary the moment this one's block
// scrolls out of view. DayAlertsBanner stays outside the Accordion
// entirely — a park-closure warning has to stay visible even while the day
// is collapsed, so it can never live inside AccordionDetails. The info
// strip itself (DayTravelChip/DayWeatherChips) only renders while expanded
// — tapping DayTravelChip opens the map dialog directly, so there's no
// separate map button; collapsing a day hides it along with everything
// else in AccordionDetails' spirit, even though the strip technically
// lives in AccordionSummary for sticky-positioning reasons.
//
// Memoized: DaysView holds several bits of dialog-open state (the map
// dialog, scroll elevation) that change on nearly every tap. Without memo, each of those
// unrelated state changes would re-render every one of the ~28 unvirtualized
// day blocks and everything under them, not just the one row that was
// actually clicked.
export const DayAccordion = memo(function DayAccordion({
  day,
  onOpenMap,
  onAddEvent,
  poster,
}: {
  day: Day;
  onOpenMap: (day: Day) => void;
  onAddEvent: (day: Day) => void;
  // Shows the day's poster above it: the trip's first date, for the poster's day number.
  poster?: { tripStart: string | null };
}) {
  const [expanded, setExpanded] = useState(true);
  const { ref: infoRef, inView } = useInViewport<HTMLDivElement>();

  return (
    <Box
      component="section"
      id={dayElementId(day.date)}
      sx={{ scrollMarginTop: `calc(${DAYS_APP_BAR_HEIGHT} + ${DAY_SCROLL_GAP})` }}
    >
      {poster && <DayPoster day={day} tripStart={poster.tripStart} />}
      <DayAlertsBanner day={day} />
      <Accordion
        expanded={expanded}
        onChange={(_, isExpanded) => setExpanded(isExpanded)}
        disableGutters
        elevation={0}
        slotProps={{ transition: { unmountOnExit: true } }}
        sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-label={expanded ? `Collapse ${day.dateLabel}` : `Expand ${day.dateLabel}`}
          sx={{
            position: 'sticky',
            top: DAYS_APP_BAR_HEIGHT,
            zIndex: 2,
            bgcolor: 'background.default',
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              width: '100%',
              minWidth: 0,
              gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1.4fr)' },
              gridTemplateAreas: {
                xs: `"title" "info"`,
                sm: `"title info"`,
              },
              columnGap: 1,
              rowGap: 0.75,
              alignItems: 'center',
            }}
          >
            <Box sx={{ gridArea: 'title', minWidth: 0 }}>
              <DayHeader day={day} expanded={expanded} poster={Boolean(poster)} />
            </Box>
            {/* Stays mounted while collapsed (hidden via display:none, not
                unmounted) so this box's viewport latch and DayTravelChip/
                DayWeatherChips' resolved weather/travel keep their state
                across a collapse/re-expand instead of re-fetching and
                flashing loading skeletons again every time. One latch here
                (rather than one per child) means the two rows observe a
                single shared element instead of two. */}
            <Box
              ref={infoRef}
              sx={{
                gridArea: 'info',
                minWidth: 0,
                justifySelf: { xs: 'stretch', sm: 'end' },
                display: expanded ? 'block' : 'none',
              }}
            >
              <DayInfoStrip>
                <DayTravelChip day={day} onOpenMap={onOpenMap} inView={inView} />
                <DayWeatherChips day={day} inView={inView} />
              </DayInfoStrip>
            </Box>
          </Box>
          <DayMenu day={day} />
        </AccordionSummary>
        <AccordionDetails sx={{ px: 2 }}>
          <NotesCluster notes={day.notes} />
          <DayTimeline day={day} rows={day.rows} containerId={day.date} />
        </AccordionDetails>
        <AccordionActions>
          <AddNoteButton date={day.date} dateLabel={day.dateLabel} />
          <AddToDayButton day={day} onAdd={onAddEvent} />
        </AccordionActions>
      </Accordion>
    </Box>
  );
});
