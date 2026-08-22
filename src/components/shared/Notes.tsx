import { useState, type MouseEvent } from 'react';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';
import EditIcon from '@mui/icons-material/Edit';

import { useNoteEdit } from '../../state/NoteEditContext';
import { LinkifiedText } from './LinkifiedText';
import type { Note, NoteKind } from '../../model/types';

const NOTE_ICON: Record<NoteKind, typeof WarningIcon> = {
  warning: WarningIcon,
  info: InfoIcon,
  footnote: NotesIcon,
};

const ALERT_SEVERITY: Partial<Record<NoteKind, 'warning' | 'info'>> = { warning: 'warning', info: 'info' };

const KIND_ORDER: Record<NoteKind, number> = { warning: 0, info: 1, footnote: 2 };

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

// A row-attached entity (a Stay, a Transit's Depart row, an Activity) splits
// its own notes into three slots — see DayTimeline's node components (and
// ActivityRow/MealRow, which place `mid` for their own entity): `above`
// (alert) renders above the whole row, `mid` (info) renders inside the row,
// after its own text/detail content but before any trailing chips
// (traveler/booking chips, meal-option chips), and `below` (footnote) renders
// below the whole row, after those chips. Anything with no single row to
// attach to (a whole Day, Leg, or Scenario track) renders its notes as one
// NotesCluster instead, kind-ordered the same way.
export function splitNotes(notes: Note[]): { above: Note[]; mid: Note[]; below: Note[] } {
  const sorted = sortNotes(notes);
  return {
    above: sorted.filter((n) => n.kind === 'warning'),
    mid: sorted.filter((n) => n.kind === 'info'),
    below: sorted.filter((n) => n.kind === 'footnote'),
  };
}

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
// reveal, so it isn't clickable at all. warning/info render as a colored MUI
// Alert; footnote stays a plain muted line (smaller type, since a footnote is
// the quietest of the three kinds) — both carry an Edit action wired to
// NoteEditContext.
function NoteChip({ note, expanded }: { note: Note; expanded: boolean }) {
  const [open, setOpen] = useState(false);
  const [tapped, setTapped] = useState(false);
  const { openNoteEdit } = useNoteEdit();
  const Icon = NOTE_ICON[note.kind];
  const severity = ALERT_SEVERITY[note.kind];
  const truncatable = note.text.length > TRUNCATE_CHAR_THRESHOLD;

  const clamp = !expanded && !open;
  // A `mid` note now sometimes renders inside a row's own clickable area
  // (see ActivityRow/MealRow/DayTimeline's StayNode/TransitBoundaryNode) —
  // stopPropagation keeps a tap on the note from also firing that row's
  // "open the detail sheet" handler.
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (!expanded && truncatable) setOpen((v) => !v);
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
  const clickable = !expanded;
  const showEdit = expanded || tapped;

  if (severity) {
    return (
      <Alert
        severity={severity}
        icon={<Icon fontSize="inherit" />}
        action={showEdit ? editButton : undefined}
        onClick={toggle}
        sx={{ cursor: clickable ? 'pointer' : 'default', alignItems: 'flex-start' }}
      >
        <Typography variant="body2" sx={textSx}>
          <LinkifiedText text={note.text} />
        </Typography>
      </Alert>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      onClick={toggle}
      sx={{ alignItems: 'flex-start', cursor: clickable ? 'pointer' : 'default', color: 'text.secondary' }}
    >
      <Icon fontSize="small" sx={{ mt: '2px', flexShrink: 0 }} />
      <Typography variant="caption" color="inherit" sx={{ flexGrow: 1, ...textSx }}>
        <LinkifiedText text={note.text} />
      </Typography>
      {showEdit && editButton}
    </Stack>
  );
}

// `expanded` opts a caller out of the two-line clamp entirely (full text,
// always) — for a side sheet or drill-down dialog where the note already has
// the reader's full attention and a screen's worth of room, vs. the compact
// day-list rendering where the clamp keeps a long footnote from dominating
// the row it's attached to.
export function NotesCluster({ notes, expanded = false }: { notes: Note[] | null | undefined; expanded?: boolean }) {
  if (!notes?.length) return null;
  return (
    <Stack spacing={0.5} sx={{ my: 0.5 }}>
      {sortNotes(notes).map((note) => (
        <NoteChip key={note._id} note={note} expanded={expanded} />
      ))}
    </Stack>
  );
}
