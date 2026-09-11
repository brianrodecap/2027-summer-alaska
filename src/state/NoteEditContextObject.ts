import { createContext } from 'react';

import type { Note, NoteKind, Ref } from '../model/types';

// An item already resolved (saved or skipped) earlier in the same draft
// sequence, kept so NoteEditDialog's own Back button can return to it —
// most-recently-resolved last, so Back always pops the one just left.
// `savedId` is set only when this entry actually became a real Note (Back
// then reopens it pointed at that same id, so Save updates it in place
// instead of appending a duplicate); left unset for a skipped entry, which
// Back reopens exactly as it was — still undecided.
export interface NoteHistoryEntry {
  ref: Ref;
  kind: NoteKind;
  text: string;
  savedId?: string;
}

// `text`, when given, seeds the dialog's text field instead of leaving it
// blank — the AI document-import flow's own way of handing over an
// already-drafted note for review rather than making a human retype what it
// found (see openNoteDraftSequence). `queue` (create only) holds whatever
// drafts still follow this one in that same sequence; `history` holds
// whatever already-resolved ones came before it, for Back. `savedId` (create
// only) is set once this exact draft has already been saved as a real Note
// (reached again via Back) — Save then updates that Note instead of
// creating a second one.
export type NoteTarget =
  | {
      mode: 'create';
      ref: Ref;
      kind: NoteKind;
      text?: string;
      savedId?: string;
      history: NoteHistoryEntry[];
      queue: NoteDraft[];
    }
  | { mode: 'edit'; note: Note };

export interface NoteDraft {
  ref: Ref;
  kind: NoteKind;
  text: string;
}

export interface NoteEditContextValue {
  // ref is whatever the new note should concern — an entity ref for a
  // row-attached note (see RowMenu), or a date/dateRange ref for a
  // whole-day one (see DayBlock's AddDayNoteButton).
  openNoteCreate: (ref: Ref, kind: NoteKind) => void;
  openNoteEdit: (note: Note) => void;
  // Reviews a batch of already-drafted notes one at a time, each through the
  // same NoteEditDialog a manual "Add alert/info/footnote" opens — used by
  // the AI document-import flow (see documentImport.ts's noteworthy
  // callouts) once its own primary Stay/Activity/Transit draft has saved.
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
