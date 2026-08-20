import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';

import type { Note, NoteKind } from '../../model/types';

const NOTE_ICON: Record<NoteKind, typeof WarningIcon> = {
  warning: WarningIcon,
  info: InfoIcon,
  footnote: NotesIcon,
};

const NOTE_COLOR: Record<NoteKind, 'error' | 'info' | 'text.secondary'> = {
  warning: 'error',
  info: 'info',
  footnote: 'text.secondary',
};

function NoteRow({ note }: { note: Note }) {
  const Icon = NOTE_ICON[note.kind] ?? InfoIcon;
  const color = NOTE_COLOR[note.kind] ?? 'text.secondary';
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', color }}>
      <Icon fontSize="small" sx={{ mt: '2px' }} />
      <Typography variant="body2" color="inherit">
        {note.text}
      </Typography>
    </Stack>
  );
}

export function Notes({ notes }: { notes: Note[] | null | undefined }) {
  if (!notes?.length) return null;
  return (
    <Stack spacing={1} sx={{ my: 1 }}>
      {notes.map((note) => (
        <NoteRow key={note._id} note={note} />
      ))}
    </Stack>
  );
}
