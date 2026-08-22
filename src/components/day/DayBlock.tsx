import AddIcon from '@mui/icons-material/Add';
import MapIcon from '@mui/icons-material/Map';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { memo, useState } from 'react';

import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
} from '../../model/types';
import { type EditKind, useEdit } from '../../state/EditContext';
import { ImportDocumentDialog } from '../edit/ImportDocumentDialog';
import { NotesCluster } from '../shared/Notes';
import { DayTimeline } from './DayTimeline';

const ADD_MENU_ITEMS: { kind: EditKind; label: string }[] = [
  { kind: 'activity', label: 'Activity' },
  { kind: 'stay', label: 'Stay' },
  { kind: 'transit', label: 'Transit' },
];

// The day block's own footer — lets a day that's missing something (a meal,
// a leg of a drive, a place to sleep) grow a new Stay/Transit/Activity right
// where it belongs, instead of only ever editing what's already there.
function AddToDayButton({ day }: { day: Day }) {
  const { openCreate } = useEdit();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <Button startIcon={<AddIcon />} onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ mt: 1 }}>
        Add to this day
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {ADD_MENU_ITEMS.map((item) => (
          <MenuItem
            key={item.kind}
            onClick={() => {
              setAnchorEl(null);
              openCreate(item.kind, day.leg._id, day.date);
            }}
          >
            {item.label}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setImportOpen(true);
          }}
        >
          From a document…
        </MenuItem>
      </Menu>
      {importOpen && (
        <ImportDocumentDialog
          legId={day.leg._id}
          date={day.date}
          onClose={() => setImportOpen(false)}
        />
      )}
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
        <AddToDayButton day={day} />
      </Box>
    </Box>
  );
});
