import { describe, expect, it } from 'vitest';

import {
  firstDraft,
  nextDraft,
  noteDialogActions,
  type NoteDraft,
  type NoteTarget,
  previousDraft,
  upsertNote,
} from './noteDrafts';
import type { Note, Ref } from './types';

const stay: Ref = { entity: 'stay', id: 's1' };
const first: NoteDraft = { ref: stay, kind: 'warning', text: 'First note' };
const second: NoteDraft = { ref: stay, kind: 'info', text: 'Second note' };

describe('a draft note sequence', () => {
  it('has nothing to show for no drafts', () => {
    expect(firstDraft([])).toBeNull();
  });

  it('says more are queued until the last draft, which ends the sequence', () => {
    const one = firstDraft([first, second])!;
    expect(one.text).toBe('First note');
    expect(noteDialogActions(one).hasMoreQueued).toBe(true);

    const two = nextDraft(one, first, 'n1')!;
    expect(two.text).toBe('Second note');
    expect(noteDialogActions(two).hasMoreQueued).toBe(false);

    expect(nextDraft(two, second, 'n2')).toBeNull();
  });

  it('offers Back only once a draft has been resolved', () => {
    const one = firstDraft([first, second])!;
    expect(noteDialogActions(one).canGoBack).toBe(false);
    expect(previousDraft(one, 'warning', 'First note')).toBeNull();

    const two = nextDraft(one, first, 'n1')!;
    expect(noteDialogActions(two)).toMatchObject({ canSkip: true, canGoBack: true });
  });

  it('goes Back to the saved note under its id, and shows the one left again after it', () => {
    const one = firstDraft([first, second])!;
    const two = nextDraft(one, first, 'n1')!;

    const back = previousDraft(two, 'info', 'Second, edited')!;
    expect(back).toMatchObject({ text: 'First note', savedId: 'n1' });
    expect(back.queue).toEqual([{ ref: stay, kind: 'info', text: 'Second, edited' }]);

    const again = nextDraft(back, { ...first, text: 'First, edited' }, 'n1')!;
    expect(again.text).toBe('Second, edited');
  });

  it('goes Back to the draft just left, not an earlier one', () => {
    const third: NoteDraft = { ref: stay, kind: 'info', text: 'Third note' };
    const one = firstDraft([first, second, third])!;
    const two = nextDraft(one, first, 'n1')!;
    const three = nextDraft(two, second, 'n2')!;
    const back = previousDraft(three, 'info', 'Third note')!;
    expect(back).toMatchObject({ text: 'Second note', savedId: 'n2' });
    expect(previousDraft(back, 'info', 'Second note')).toMatchObject({ text: 'First note' });
  });

  it('keeps each saved draft’s Note when going Back twice and forward again', () => {
    const third: NoteDraft = { ref: stay, kind: 'info', text: 'Third note' };
    const two = nextDraft(firstDraft([first, second, third])!, first, 'n1')!;
    const three = nextDraft(two, second, 'n2')!;
    const backToTwo = previousDraft(three, 'info', 'Third note')!;
    const backToOne = previousDraft(backToTwo, 'info', 'Second note')!;
    const forwardToTwo = nextDraft(backToOne, first, 'n1')!;
    expect(forwardToTwo).toMatchObject({ text: 'Second note', savedId: 'n2' });
  });

  it('keeps a skipped draft undecided, so Back reopens it without a saved id', () => {
    const one = firstDraft([first, second])!;
    const two = nextDraft(one, first, undefined)!;
    expect(previousDraft(two, 'info', 'Second note')!.savedId).toBeUndefined();
  });

  it('offers no Skip or Back for a plain manual note', () => {
    const manual: NoteTarget = { mode: 'create', ref: stay, kind: 'info', history: [], queue: [] };
    expect(noteDialogActions(manual)).toEqual({
      canDelete: false,
      canSkip: false,
      canGoBack: false,
      hasMoreQueued: false,
    });
  });

  it('offers Delete only for an existing note', () => {
    const note: Note = { _id: 'n1', kind: 'info', text: 'x', concerns: [stay], images: [] };
    expect(noteDialogActions({ mode: 'edit', note })).toMatchObject({
      canDelete: true,
      canSkip: false,
    });
  });
});

describe('upsertNote', () => {
  it('adds a new note concerning its entry', () => {
    expect(upsertNote([], 'n1', stay, 'info', 'Hello')).toEqual([
      { _id: 'n1', kind: 'info', text: 'Hello', concerns: [stay], images: [] },
    ]);
  });

  it('updates a note saved before under the same id instead of adding a copy', () => {
    const saved = upsertNote([], 'n1', stay, 'warning', 'First note');
    const resaved = upsertNote(saved, 'n1', stay, 'info', 'First, edited');
    expect(resaved).toEqual([
      { _id: 'n1', kind: 'info', text: 'First, edited', concerns: [stay], images: [] },
    ]);
  });
});
