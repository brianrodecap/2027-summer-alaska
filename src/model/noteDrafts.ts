import type { Note, NoteKind, Ref } from './types';

// A draft already resolved earlier in its sequence, kept for Back. `savedId` is
// set when it was saved as a Note (Back then updates that Note), unset when skipped.
export interface NoteHistoryEntry {
  ref: Ref;
  kind: NoteKind;
  text: string;
  savedId?: string;
}

export interface NoteDraft {
  ref: Ref;
  kind: NoteKind;
  text: string;
}

// A draft still to come: one Back stepped over keeps the Note it was saved as.
type QueuedDraft = NoteDraft & { savedId?: string };

// The note the dialog shows. A create's `text` seeds the field with a drafted
// note under review; `queue` holds the drafts after it, `history` the ones
// resolved before it, and `savedId` the Note it was already saved as.
export type NoteTarget = CreateTarget | { mode: 'edit'; note: Note };

export interface CreateTarget {
  mode: 'create';
  ref: Ref;
  kind: NoteKind;
  text?: string;
  savedId?: string;
  history: NoteHistoryEntry[];
  queue: QueuedDraft[];
}

function createTarget(
  { ref, kind, text, savedId }: QueuedDraft,
  history: NoteHistoryEntry[],
  queue: QueuedDraft[],
): CreateTarget {
  return { mode: 'create', ref, kind, text, savedId, history, queue };
}

// The first draft of a sequence, or null when there is nothing to review.
export function firstDraft(drafts: NoteDraft[]): CreateTarget | null {
  if (!drafts.length) return null;
  const [first, ...rest] = drafts;
  return createTarget(first, [], rest);
}

// Once the draft on screen is resolved (saved, with its final id, or declined),
// it goes into history so Back can return to it, and the next queued draft is
// shown — or null when this was the last one.
export function nextDraft(
  target: CreateTarget,
  current: NoteDraft,
  savedId: string | undefined,
): CreateTarget | null {
  if (!target.queue.length) return null;
  const [next, ...rest] = target.queue;
  return createTarget(next, [...target.history, { ...current, savedId }], rest);
}

// Returns to the draft resolved just before this one. The one being left (with
// its current, possibly-edited kind/text, and the Note it was saved as) goes back
// onto the front of the queue, so it's shown again once the earlier one is
// resolved. Null with no history.
export function previousDraft(
  target: CreateTarget,
  kind: NoteKind,
  text: string,
): CreateTarget | null {
  const prev = target.history.at(-1);
  if (!prev) return null;
  return createTarget(prev, target.history.slice(0, -1), [
    { ref: target.ref, kind, text, savedId: target.savedId },
    ...target.queue,
  ]);
}

// Saves a reviewed draft under `id`: a draft reached again via Back, already
// saved once, updates that note in place instead of appending a duplicate.
export function upsertNote(
  notes: Note[],
  id: string,
  ref: Ref,
  kind: NoteKind,
  text: string,
): Note[] {
  if (notes.some((n) => n._id === id)) {
    return notes.map((n) => (n._id === id ? { ...n, kind, text } : n));
  }
  return [...notes, { _id: id, kind, text, concerns: [ref], images: [] }];
}

// What the dialog offers for a target. Skip and Back are for a drafted note under
// review (one handed over with its text), so declining one doesn't cost the
// drafts still waiting; a plain manual create has no queue, and Cancel covers it.
export function noteDialogActions(target: NoteTarget) {
  const draft = target.mode === 'create' && target.text !== undefined ? target : null;
  return {
    canDelete: target.mode === 'edit',
    canSkip: draft !== null,
    canGoBack: draft !== null && draft.history.length > 0,
    hasMoreQueued: target.mode === 'create' && target.queue.length > 0,
  };
}
