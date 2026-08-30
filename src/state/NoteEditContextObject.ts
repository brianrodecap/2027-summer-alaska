import { createContext } from 'react';

import type { Note, NoteKind, Ref } from '../model/types';

export type NoteTarget =
  { mode: 'create'; ref: Ref; kind: NoteKind } | { mode: 'edit'; note: Note };

export interface NoteEditContextValue {
  // ref is whatever the new note should concern — an entity ref for a
  // row-attached note (see RowMenu), or a date/dateRange ref for a
  // whole-day one (see DayBlock's AddDayNoteButton).
  openNoteCreate: (ref: Ref, kind: NoteKind) => void;
  openNoteEdit: (note: Note) => void;
}

export const NoteEditContext = createContext<NoteEditContextValue | null>(null);
