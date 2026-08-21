import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Collapse from '@mui/material/Collapse';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';
import EditIcon from '@mui/icons-material/Edit';

import { useNoteEdit } from '../../state/NoteEditContext';
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
// its own notes into what renders above it (alert, then info) and what
// renders below (footnote) — see DayTimeline's node components. Anything
// with no single row to attach to (a whole Day, Leg, or Scenario track)
// renders its notes as one NotesCluster instead, kind-ordered the same way.
export function splitNotes(notes: Note[]): { above: Note[]; below: Note[] } {
  const sorted = sortNotes(notes);
  return { above: sorted.filter((n) => n.kind !== 'footnote'), below: sorted.filter((n) => n.kind === 'footnote') };
}

// Each note starts collapsed to just its icon; a click expands it in place —
// a colored MUI Alert for warning/info (with an Edit action wired to
// NoteEditContext), or a plain muted line for footnote, since a footnote
// reads as a quiet aside rather than a banner-worthy alert.
function NoteChip({ note }: { note: Note }) {
  const [open, setOpen] = useState(false);
  const { openNoteEdit } = useNoteEdit();
  const Icon = NOTE_ICON[note.kind];
  const severity = ALERT_SEVERITY[note.kind];

  const editButton = (
    <IconButton size="small" aria-label="Edit note" onClick={() => openNoteEdit(note)}>
      <EditIcon fontSize="inherit" />
    </IconButton>
  );

  return (
    <Box>
      <IconButton
        size="small"
        aria-label={open ? 'Collapse note' : 'Expand note'}
        onClick={() => setOpen((v) => !v)}
        color={note.kind === 'warning' ? 'error' : note.kind === 'info' ? 'info' : 'default'}
        sx={note.kind === 'footnote' ? { color: 'text.secondary' } : undefined}
      >
        <Icon fontSize="small" />
      </IconButton>
      <Collapse in={open}>
        {severity ? (
          <Alert severity={severity} icon={<Icon fontSize="inherit" />} action={editButton} sx={{ mt: 0.5 }}>
            {note.text}
          </Alert>
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', pl: 1, py: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              {note.text}
            </Typography>
            {editButton}
          </Stack>
        )}
      </Collapse>
    </Box>
  );
}

export function NotesCluster({ notes }: { notes: Note[] | null | undefined }) {
  if (!notes?.length) return null;
  return (
    <Stack spacing={0.5} sx={{ my: 0.5 }}>
      {sortNotes(notes).map((note) => (
        <NoteChip key={note._id} note={note} />
      ))}
    </Stack>
  );
}
