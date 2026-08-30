import { type ReactNode, useState } from 'react';

import { NoteEditDialog } from '../components/notes/NoteEditDialog';
import type { Note, NoteKind, Ref } from '../model/types';
import { NoteEditContext, type NoteTarget } from './NoteEditContextObject';
import { useTripData } from './useTripData';

// Mirrors EditContext's own shape (a target + a dialog mounted once here),
// kept separate because a Note's create/edit/delete flow is genuinely
// different from Activity/Stay/Transit's: concerns is fixed at creation
// (see NoteEditDialog) rather than built from a full form, so there's no
// shared form-state machinery worth merging the two contexts over.
export function NoteEditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [target, setTarget] = useState<NoteTarget | null>(null);

  const openNoteCreate = (ref: Ref, kind: NoteKind) => setTarget({ mode: 'create', ref, kind });
  const openNoteEdit = (note: Note) => setTarget({ mode: 'edit', note });
  const closeNoteEdit = () => setTarget(null);

  const handleSave = (kind: NoteKind, text: string) => {
    if (!target) return;
    setData(
      (prev) => {
        if (target.mode === 'create') {
          const note: Note = {
            _id: crypto.randomUUID(),
            kind,
            text,
            concerns: [target.ref],
            images: [],
          };
          return { ...prev, notes: [...prev.notes, note] };
        }
        const id = target.note._id;
        return { ...prev, notes: prev.notes.map((n) => (n._id === id ? { ...n, kind, text } : n)) };
      },
      ['notes'],
    );
    closeNoteEdit();
  };

  const handleDelete = () => {
    if (!target || target.mode !== 'edit') return;
    const id = target.note._id;
    setData((prev) => ({ ...prev, notes: prev.notes.filter((n) => n._id !== id) }), ['notes']);
    closeNoteEdit();
  };

  return (
    <NoteEditContext.Provider value={{ openNoteCreate, openNoteEdit }}>
      {children}
      {target && data && (
        <NoteEditDialog
          target={target}
          onClose={closeNoteEdit}
          onSave={handleSave}
          onDelete={target.mode === 'edit' ? handleDelete : undefined}
        />
      )}
    </NoteEditContext.Provider>
  );
}
