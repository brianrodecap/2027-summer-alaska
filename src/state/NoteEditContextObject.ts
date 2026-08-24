import { createContext } from 'react';

import type { Note, NoteKind, RefEntityKind } from '../model/types';

export type NoteTarget =
  | { mode: 'create'; entity: RefEntityKind; id: string; kind: NoteKind }
  | { mode: 'edit'; note: Note };

export interface NoteEditContextValue {
  openNoteCreate: (entity: RefEntityKind, id: string, kind: NoteKind) => void;
  openNoteEdit: (note: Note) => void;
}

export const NoteEditContext = createContext<NoteEditContextValue | null>(null);
