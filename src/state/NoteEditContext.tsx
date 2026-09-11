import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { NoteEditDialog } from '../components/notes/NoteEditDialog';
import type { Note, NoteKind, Ref } from '../model/types';
import {
  type NoteDraft,
  NoteEditContext,
  type NoteHistoryEntry,
  type NoteTarget,
} from './NoteEditContextObject';
import { useTripData } from './useTripData';

// Shared by openNoteDraftSequence/advance/handleBack: builds the 'create'
// NoteTarget for whichever draft is becoming current, carrying over the
// history/queue each of those three call sites computes differently.
function createTarget(
  item: { ref: Ref; kind: NoteKind; text?: string; savedId?: string },
  history: NoteHistoryEntry[],
  queue: NoteDraft[],
): NoteTarget {
  return {
    mode: 'create',
    ref: item.ref,
    kind: item.kind,
    text: item.text,
    savedId: item.savedId,
    history,
    queue,
  };
}

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
      if (!drafts.length) {
        onComplete?.();
        return;
      }
      const [first, ...rest] = drafts;
      onCompleteRef.current = onComplete;
      show(createTarget(first, [], rest));
    },
    [show],
  );
  // Abandons the rest of a draft sequence rather than advancing past it — a
  // viewer who bails on the whole review shouldn't have the remaining ones
  // saved without ever being shown. Declining just the one currently on
  // screen while keeping the rest of the queue going is handleSkip's job
  // instead (see NoteEditDialog's own Skip button).
  const closeNoteEdit = useCallback(() => {
    setTarget(null);
    const onComplete = onCompleteRef.current;
    onCompleteRef.current = undefined;
    onComplete?.();
  }, []);

  // Shared by handleSave and handleSkip: once this step is resolved (saved
  // or declined, `resolved` describing which and, for a save, its final id),
  // record it in history so Back can return to it, then move on to whatever
  // is still queued, or close if this was the last one.
  const advance = useCallback(
    (current: { ref: Ref; kind: NoteKind; text: string }, savedId: string | undefined) => {
      if (!target || target.mode !== 'create') return;
      const historyEntry: NoteHistoryEntry = { ...current, savedId };
      const history = [...target.history, historyEntry];
      const { queue } = target;
      if (queue.length) {
        const [next, ...rest] = queue;
        show(createTarget(next, history, rest));
      } else {
        closeNoteEdit();
      }
    },
    [target, closeNoteEdit, show],
  );

  const handleSave = useCallback(
    (kind: NoteKind, text: string) => {
      if (!target) return;
      if (target.mode === 'edit') {
        const id = target.note._id;
        setData(
          (prev) => ({
            ...prev,
            notes: prev.notes.map((n) => (n._id === id ? { ...n, kind, text } : n)),
          }),
          ['notes'],
        );
        closeNoteEdit();
        return;
      }
      // A draft reached again via Back that was already saved once updates
      // that same Note in place rather than appending a duplicate.
      const savedId = target.savedId ?? crypto.randomUUID();
      setData(
        (prev) => {
          if (prev.notes.some((n) => n._id === savedId)) {
            return {
              ...prev,
              notes: prev.notes.map((n) => (n._id === savedId ? { ...n, kind, text } : n)),
            };
          }
          const note: Note = { _id: savedId, kind, text, concerns: [target.ref], images: [] };
          return { ...prev, notes: [...prev.notes, note] };
        },
        ['notes'],
      );
      advance({ ref: target.ref, kind, text }, savedId);
    },
    [target, setData, advance, closeNoteEdit],
  );

  // Declines the note currently on screen — nothing is written to notes,
  // and any earlier save under this same position (reached via Back) is
  // left exactly as it was — then moves on to the rest of its queue, if
  // any. Only offered (see NoteEditDialog's own onSkip prop below) for a
  // drafted note under review, where "I don't want this one" shouldn't cost
  // the viewer the other drafts still waiting; a plain manual "Add
  // alert/info/footnote" has no queue to preserve, so Cancel already covers
  // it.
  const handleSkip = useCallback(() => {
    if (!target || target.mode !== 'create') return;
    advance({ ref: target.ref, kind: target.kind, text: target.text ?? '' }, target.savedId);
  }, [target, advance]);

  // Returns to whichever draft was on screen just before this one — the one
  // just left (with the caller's own current, possibly-edited kind/text) is
  // pushed back onto the front of the queue so it's shown again once the
  // popped-back one is itself resolved. Only offered for a drafted note
  // with something in its own history (see NoteEditDialog's own onBack
  // prop) — there's nothing to go back to on the very first item, or for a
  // plain manual create.
  const handleBack = useCallback(
    (kind: NoteKind, text: string) => {
      if (!target || target.mode !== 'create' || !target.history.length) return;
      const history = [...target.history];
      const prev = history.pop() as NoteHistoryEntry;
      const requeued: NoteDraft = { ref: target.ref, kind, text };
      show(createTarget(prev, history, [requeued, ...target.queue]));
    },
    [target, show],
  );

  const handleDelete = useCallback(() => {
    if (!target || target.mode !== 'edit') return;
    const id = target.note._id;
    setData((prev) => ({ ...prev, notes: prev.notes.filter((n) => n._id !== id) }), ['notes']);
    closeNoteEdit();
  }, [target, setData, closeNoteEdit]);

  const contextValue = useMemo(
    () => ({ openNoteCreate, openNoteEdit, openNoteDraftSequence }),
    [openNoteCreate, openNoteEdit, openNoteDraftSequence],
  );

  const isDraft = target?.mode === 'create' && target.text !== undefined;

  return (
    <NoteEditContext.Provider value={contextValue}>
      {children}
      {target && data && (
        <NoteEditDialog
          key={sequence}
          target={target}
          onClose={closeNoteEdit}
          onSave={handleSave}
          onDelete={target.mode === 'edit' ? handleDelete : undefined}
          onSkip={isDraft ? handleSkip : undefined}
          onBack={
            isDraft && target.mode === 'create' && target.history.length ? handleBack : undefined
          }
          hasMoreQueued={target.mode === 'create' && target.queue.length > 0}
        />
      )}
    </NoteEditContext.Provider>
  );
}
