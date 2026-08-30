import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';
import WarningIcon from '@mui/icons-material/Warning';

import type { Note, NoteKind } from '../../model/types';

export const NOTE_ICON: Record<NoteKind, typeof WarningIcon> = {
  warning: WarningIcon,
  info: InfoIcon,
  footnote: NotesIcon,
};

// Shared by every "add a note" menu (RowMenu's per-row menu, DayBlock's
// day-level one) so the three kinds always offer the same label/order.
export const ADD_NOTE_ITEMS: { kind: NoteKind; label: string }[] = [
  { kind: 'warning', label: 'Add alert' },
  { kind: 'info', label: 'Add info' },
  { kind: 'footnote', label: 'Add footnote' },
];

const KIND_ORDER: Record<NoteKind, number> = { warning: 0, info: 1, footnote: 2 };

export function sortNotes(notes: Note[]): Note[] {
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
