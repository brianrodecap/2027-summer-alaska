import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';
import WarningIcon from '@mui/icons-material/Warning';

import type { Note, NoteKind } from '../../model/types';

export const NOTE_ICON: Record<NoteKind, typeof WarningIcon> = {
  warning: WarningIcon,
  info: InfoIcon,
  footnote: NotesIcon,
};

// The kind a new note starts as; the note dialog changes it.
export const DEFAULT_NOTE_KIND: NoteKind = 'info';

const KIND_ORDER: Record<NoteKind, number> = { warning: 0, info: 1, footnote: 2 };

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

// Notes split by kind, for a card, which places each kind apart.
export function splitNotes(notes: Note[]): { above: Note[]; mid: Note[]; below: Note[] } {
  const sorted = sortNotes(notes);
  return {
    above: sorted.filter((n) => n.kind === 'warning'),
    mid: sorted.filter((n) => n.kind === 'info'),
    below: sorted.filter((n) => n.kind === 'footnote'),
  };
}
