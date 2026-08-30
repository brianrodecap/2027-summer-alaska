import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Typography from '@mui/material/Typography';
import { memo } from 'react';

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
import { DayTimeline } from './DayTimeline';
import { DayWeatherStrip } from './DayWeatherStrip';
import { activeTitleCandidates } from './scenarioSelection';

// The day block's own footer — lets a day that's missing something (a meal,
// a leg of a drive, a place to sleep, a weather-branch) grow a new entry
// right where it belongs, instead of only ever editing what's already
// there. Launches the guided AddEventWizard directly rather than a menu of
// entity kinds — "what are you adding?" is the wizard's own first question
// now, not something this button has to ask up front.
function AddToDayButton({ day, onAdd }: { day: Day; onAdd: (day: Day) => void }) {
  return (
    <Button startIcon={<AddIcon />} onClick={() => onAdd(day)} sx={{ mt: 1 }}>
      Add to this day
    </Button>
  );
}

// A day-level note concerns the whole date (concerns: [{ date }]) rather
// than any one Stay/Transit/Activity row — see tripModel's notesForDay and
// NotesCluster's rendering of day.notes above the timeline. Mirrors
// RowMenu's own "add note" menu, just seeded with a date ref instead of an
// entity ref.
function AddDayNoteButton({ date, dateLabel }: { date: string; dateLabel: string }) {
  const { anchorEl, openAt, close, pick } = useAnchorMenu();
  const { openNoteCreate } = useNoteEdit();

  return (
    <>
      <IconButton aria-label={`Add a note for ${dateLabel}`} onClick={openAt}>
        <NoteAddIcon />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={close}>
        <AddNoteMenuItems onPick={(kind) => pick(() => openNoteCreate({ date }, kind))} />
      </Menu>
    </>
  );
}

// One <section> per Day with a sticky header (date + title) and its full
// Stay/Transit/Activity detail rendered inline underneath — position: sticky
// within its own block, so it stays pinned to the top of the viewport while
// that day's content scrolls past, then hands off to the next day's header
// the moment this one's block scrolls out of view.
//
// Memoized: DaysView holds several bits of dialog-open state (which
// activity/stay/transit side sheet is open, the map dialog, scroll
// elevation) that change on nearly every tap. Without memo, each of those
// unrelated state changes would re-render every one of the ~28 unvirtualized
// day blocks and everything under them, not just the one row that was
// actually clicked.
export const DayBlock = memo(function DayBlock({
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
          <Typography variant="h6">{title}</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexShrink: 0 }}>
          <AddDayNoteButton date={day.date} dateLabel={day.dateLabel} />
          <IconButton aria-label={`Map for ${day.dateLabel}`} onClick={() => onOpenMap(day)}>
            <MapIcon />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ px: 3, py: 2 }}>
        <DayWeatherStrip day={day} />
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
        <AddToDayButton day={day} onAdd={onAddEvent} />
      </Box>
    </Box>
  );
});
