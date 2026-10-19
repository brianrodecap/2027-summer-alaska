import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { NoteEditDialog } from '../components/notes/NoteEditDialog';
import {
  firstDraft,
  nextDraft,
  noteDialogActions,
  type NoteDraft,
  type NoteTarget,
  previousDraft,
  upsertNote,
} from '../model/noteDrafts';
import type { Note, NoteKind, Ref } from '../model/types';
import { NoteEditContext } from './NoteEditContextObject';
import { useTripData } from './useTripData';

// Mirrors EditContext's own shape (a target + a dialog mounted once here),
// kept separate because a Note's create/edit/delete flow is genuinely
// different from Activity/Stay/Transit's: concerns is fixed at creation
// (see NoteEditDialog) rather than built from a full form, so there's no
// shared form-state machinery worth merging the two contexts over.
export function NoteEditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [target, setTarget] = useState<NoteTarget | null>(null);
  // NoteEditDialog's own text/kind state is only ever initialized once per
  // mount — advancing a draft sequence to its next item (forward via
  // Save/Skip, or backward via Back) swaps `target` but wouldn't remount
  // the dialog on its own (it stays truthy the whole time), so this key
  // forces a fresh mount (and fresh initial state) every time a genuinely
  // different note is shown.
  const [sequence, setSequence] = useState(0);
  // openNoteDraftSequence's own onComplete — a ref rather than state since
  // it's a per-sequence constant nothing here needs to re-render on, read
  // only once the whole sequence (every note reviewed, or the rest
  // cancelled) actually ends, from whichever of closeNoteEdit/advanceQueue
  // gets there. Callers like EditContext's own draft queue rely on this
  // firing exactly once, whether or not any notes were actually reviewed.
  const onCompleteRef = useRef<(() => void) | undefined>(undefined);

  // Every place that shows a genuinely different note bumps `sequence`
  // alongside `target` so NoteEditDialog's key forces a fresh mount (see the
  // sequence state's own note above) — shared here so no call site can bump
  // one without the other.
  const show = useCallback((t: NoteTarget) => {
    setTarget(t);
    setSequence((s) => s + 1);
  }, []);

  const openNoteCreate = useCallback(
    (ref: Ref, kind: NoteKind) => {
      onCompleteRef.current = undefined;
      show({ mode: 'create', ref, kind, history: [], queue: [] });
    },
    [show],
  );
  const openNoteEdit = useCallback(
    (note: Note) => {
      onCompleteRef.current = undefined;
      show({ mode: 'edit', note });
    },
    [show],
  );
  const openNoteDraftSequence = useCallback(
    (drafts: NoteDraft[], onComplete?: () => void) => {
      const first = firstDraft(drafts);
      if (!first) {
        onComplete?.();
        return;
      }
      onCompleteRef.current = onComplete;
      show(first);
    },
    [show],
  );
  // Abandons the rest of a draft sequence rather than advancing past it — a
  // viewer who bails on the whole review shouldn't have the remaining ones
  // saved without ever being shown. Declining just the one currently on
  // screen while keeping the rest of the queue going is handleSkip's job.
  const closeNoteEdit = useCallback(() => {
    setTarget(null);
    const onComplete = onCompleteRef.current;
    onCompleteRef.current = undefined;
    onComplete?.();
  }, []);

  // Shared by handleSave and handleSkip: shows the next queued draft (see
  // nextDraft), or closes if this was the last one.
  const advance = useCallback(
    (current: { ref: Ref; kind: NoteKind; text: string }, savedId: string | undefined) => {
      if (!target || target.mode !== 'create') return;
      const next = nextDraft(target, current, savedId);
      if (next) show(next);
      else closeNoteEdit();
    },
    [target, closeNoteEdit, show],
  );

  const handleSave = useCallback(
    (kind: NoteKind, text: string) => {
      if (!target) return;
      if (target.mode === 'edit') {
        const id = target.note._id;
        setData((prev) => ({
          ...prev,
          notes: prev.notes.map((n) => (n._id === id ? { ...n, kind, text } : n)),
        }));
        closeNoteEdit();
        return;
      }
      // A draft reached again via Back that was already saved once keeps its id.
      const savedId = target.savedId ?? crypto.randomUUID();
      setData((prev) => ({
        ...prev,
        notes: upsertNote(prev.notes, savedId, target.ref, kind, text),
      }));
      advance({ ref: target.ref, kind, text }, savedId);
    },
    [target, setData, advance, closeNoteEdit],
  );

  // Declines the draft on screen, leaving any earlier save under it as is, and
  // moves on (see nextDraft).
  const handleSkip = useCallback(() => {
    if (!target || target.mode !== 'create') return;
    advance({ ref: target.ref, kind: target.kind, text: target.text ?? '' }, target.savedId);
  }, [target, advance]);

  // Returns to the draft on screen just before this one (see previousDraft).
  const handleBack = useCallback(
    (kind: NoteKind, text: string) => {
      if (!target || target.mode !== 'create') return;
      const prev = previousDraft(target, kind, text);
      if (prev) show(prev);
    },
    [target, show],
  );

  const handleDelete = useCallback(() => {
    if (!target || target.mode !== 'edit') return;
    const id = target.note._id;
    setData((prev) => ({ ...prev, notes: prev.notes.filter((n) => n._id !== id) }));
    closeNoteEdit();
  }, [target, setData, closeNoteEdit]);

  const contextValue = useMemo(
    () => ({ openNoteCreate, openNoteEdit, openNoteDraftSequence }),
    [openNoteCreate, openNoteEdit, openNoteDraftSequence],
  );

  const actions = target && noteDialogActions(target);

  return (
    <NoteEditContext.Provider value={contextValue}>
      {children}
      {target && data && (
        <NoteEditDialog
          key={sequence}
          target={target}
          onClose={closeNoteEdit}
          onSave={handleSave}
          onDelete={actions?.canDelete ? handleDelete : undefined}
          onSkip={actions?.canSkip ? handleSkip : undefined}
          onBack={actions?.canGoBack ? handleBack : undefined}
          hasMoreQueued={actions?.hasMoreQueued ?? false}
        />
      )}
    </NoteEditContext.Provider>
  );
}
