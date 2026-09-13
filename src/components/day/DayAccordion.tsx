import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import Accordion from '@mui/material/Accordion';
import AccordionActions from '@mui/material/AccordionActions';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import { memo, useState } from 'react';

import { deriveTitle } from '../../model/tripModel';
import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
} from '../../model/types';
import { useNoteEdit } from '../../state/useNoteEdit';
import { useScenarioSelection } from '../../state/useTripSelections';
import { AddNoteMenuItems } from '../shared/AddNoteMenuItems';
import { NotesCluster } from '../shared/Notes';
import { useAnchorMenu } from '../shared/useAnchorMenu';
import { DayAlertsBanner } from './DayAlertsBanner';
import { DayHeader } from './DayHeader';
import { DayInfoStrip } from './DayInfoStrip';
import { DayTimeline } from './DayTimeline';
import { DayTravelChip } from './DayTravelChip';
import { DayWeatherChips } from './DayWeatherChips';
import { activeTitleCandidates } from './scenarioSelection';
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
// of day.notes above the timeline. Mirrors RowMenu's own "add note" menu,
// just seeded with a date ref instead of an entity ref. Labeled ("Add
// note") rather than icon-only now that it sits beside AddToDayButton as a
// peer action instead of alone in the header.
function AddNoteButton({ date, dateLabel }: { date: string; dateLabel: string }) {
  const { anchorEl, openAt, close, pick } = useAnchorMenu();
  const { openNoteCreate } = useNoteEdit();

  return (
    <>
      <Button
        startIcon={<NoteAddIcon />}
        onClick={openAt}
        aria-label={`Add a note for ${dateLabel}`}
        data-testid={`add-note-${date}`}
      >
        Add note
      </Button>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={close}>
        <AddNoteMenuItems onPick={(kind) => pick(() => openNoteCreate({ date }, kind))} />
      </Menu>
    </>
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
// Memoized: DaysView holds several bits of dialog-open state (which
// activity/stay/transit side sheet is open, the map dialog, scroll
// elevation) that change on nearly every tap. Without memo, each of those
// unrelated state changes would re-render every one of the ~28 unvirtualized
// day blocks and everything under them, not just the one row that was
// actually clicked.
export const DayAccordion = memo(function DayAccordion({
  day,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
  onOpenMap,
  onAddEvent,
}: {
  day: Day;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
  onOpenMap: (day: Day) => void;
  onAddEvent: (day: Day) => void;
}) {
  const { scenarioTone } = useScenarioSelection();
  const title = deriveTitle(day.location, activeTitleCandidates(day, daysByDate, scenarioTone));
  const [expanded, setExpanded] = useState(true);
  const { ref: infoRef, inView } = useInViewport<HTMLDivElement>();

  return (
    <Box component="section" id={`day-${day.date}`} sx={{ scrollMarginTop: '4.5rem' }}>
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
            top: '4rem',
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
              <DayHeader day={day} title={title} expanded={expanded} />
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
        </AccordionSummary>
        <AccordionDetails sx={{ px: 2 }}>
          <NotesCluster notes={day.notes} />
          <DayTimeline
            day={day}
            sequence={day.sequence}
            containerId={day.date}
            daysByDate={daysByDate}
            onOpenActivity={onOpenActivity}
            onOpenStay={onOpenStay}
            onOpenTransit={onOpenTransit}
          />
        </AccordionDetails>
        <AccordionActions>
          <AddNoteButton date={day.date} dateLabel={day.dateLabel} />
          <AddToDayButton day={day} onAdd={onAddEvent} />
        </AccordionActions>
      </Accordion>
    </Box>
  );
});
