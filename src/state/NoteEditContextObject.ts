import { createContext } from 'react';

import type { NoteDraft } from '../model/noteDrafts';
import type { Note, NoteKind, Ref } from '../model/types';

export interface NoteEditContextValue {
  // ref is whatever the new note should concern — an entity ref for a
  // row-attached note (see RowMenu), or a date/dateRange ref for a
  // whole-day one (see DayAccordion's AddNoteButton).
  openNoteCreate: (ref: Ref, kind: NoteKind) => void;
  openNoteEdit: (note: Note) => void;
  // Reviews a batch of already-drafted notes one at a time, each through the
  // same NoteEditDialog a manual "Add alert/info/footnote" opens — used by
  // the AI document-import flow (see proposals.ts's validateNote and
  // proposalImport.ts's add_note) once its own primary Stay/Activity/Transit draft has saved.
  // Skipping or cancelling a step never loses the rest of the queue's
  // ability to run — see NoteEditDialog's own Skip vs. Cancel-all split —
  // but a "Cancel all" does abandon whatever notes are still left. Either
  // way, `onComplete` (if given) always fires exactly once, when this
  // sequence's dialog finally closes for good (every note reviewed, or the
  // rest cancelled) — never per note. EditContext's own openDraftSequence
  // relies on this to know when it's safe to show its own next queued
  // entity, since two dialogs from two different contexts must never be
  // open at once (see EditContext.tsx's own note on this).
  openNoteDraftSequence: (drafts: NoteDraft[], onComplete?: () => void) => void;
}

export const NoteEditContext = createContext<NoteEditContextValue | null>(null);
