import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type MouseEvent, useState } from 'react';

import type { Note } from '../../model/types';
import { useNoteEdit } from '../../state/useNoteEdit';
import { LinkifiedText } from './LinkifiedText';
import { NOTE_ICON, sortNotes } from './noteKind';

// A footnote is the quietest of the three kinds: neutral text/icon color and
// no tinted fill, so it isn't mistaken for an `info` note. MUI Alert has no
// neutral severity, so a footnote borrows `info` and this strips its blue tint.
const FOOTNOTE_SX = {
  color: 'text.secondary',
  backgroundColor: 'transparent',
  '& .MuiAlert-icon': { color: 'inherit' },
};

const CLAMPED_SX = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

const FADE_MASK = 'linear-gradient(to bottom, black 55%, transparent 100%)';

// A rough chars-per-two-lines estimate (~50 chars/line at this column width)
// rather than a real DOM measurement — measuring scrollHeight/clientHeight
// per note via a layout effect forces a synchronous reflow on every note's
// mount, which gets expensive fast once a full multi-week itinerary's worth
// of notes are all mounting at once. A length heuristic is close enough for
// "does this note have more to reveal" and never touches layout.
const TRUNCATE_CHAR_THRESHOLD = 110;

// Every note shows its icon and up to its first two lines at rest, to keep
// the day list compact — long text fades out via a mask (not an ellipsis)
// so it reads as "there's more" rather than a hard cut. Clicking anywhere on
// a note that actually overflows those two lines expands it to the full
// text in place; a note that already fits in two lines has nothing more to
// reveal, so it isn't clickable at all. All three kinds render as an MUI
// Alert (footnote in neutral, untinted colors and smaller type) and carry an
// Edit action wired to NoteEditContext.
function NoteChip({ note, expanded }: { note: Note; expanded: boolean }) {
  const [open, setOpen] = useState(false);
  const [tapped, setTapped] = useState(false);
  const { openNoteEdit } = useNoteEdit();
  const Icon = NOTE_ICON[note.kind];
  const truncatable = note.text.length > TRUNCATE_CHAR_THRESHOLD;

  const clamp = !expanded && !open;
  // A `mid` note now sometimes renders inside a row's own clickable area
  // (see ActivityRow/MealRow/DayTimeline's StayNode/TransitBoundaryNode) —
  // stopPropagation keeps a tap on the note from also firing that row's
  // "open the detail sheet" handler.
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (!expanded) setOpen((v) => !v);
    setTapped((v) => !v);
  };

  const editButton = (
    <IconButton
      size="small"
      aria-label="Edit note"
      onClick={(e) => {
        e.stopPropagation();
        openNoteEdit(note);
      }}
    >
      <EditIcon fontSize="inherit" />
    </IconButton>
  );

  const textSx = {
    ...(clamp && CLAMPED_SX),
    ...(clamp && truncatable && { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }),
  };
  const isFootnote = note.kind === 'footnote';
  const clickable = !expanded;
  const showEdit = expanded || tapped;

  return (
    <Alert
      severity={note.kind === 'warning' ? 'warning' : 'info'}
      icon={<Icon fontSize="inherit" />}
      action={showEdit ? editButton : undefined}
      onClick={toggle}
      sx={{
        cursor: clickable ? 'pointer' : 'default',
        alignItems: 'flex-start',
        ...(isFootnote && FOOTNOTE_SX),
      }}
    >
      <Typography variant={isFootnote ? 'caption' : 'body2'} component="div" sx={textSx}>
        <LinkifiedText text={note.text} />
      </Typography>
    </Alert>
  );
}

// `expanded` opts a caller out of the two-line clamp entirely (full text,
// always) — for a side sheet or drill-down dialog where the note already has
// the reader's full attention and a screen's worth of room, vs. the compact
// day-list rendering where the clamp keeps a long footnote from dominating
// the row it's attached to.
export function NotesCluster({
  notes,
  expanded = false,
}: {
  notes: Note[] | null | undefined;
  expanded?: boolean;
}) {
  if (!notes?.length) return null;
  return (
    <Stack spacing={0.5} sx={{ my: 0.5 }}>
      {sortNotes(notes).map((note) => (
        <NoteChip key={note._id} note={note} expanded={expanded} />
      ))}
    </Stack>
  );
}
