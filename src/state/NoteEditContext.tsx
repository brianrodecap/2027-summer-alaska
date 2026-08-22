import { createContext, type ReactNode, useContext, useState } from 'react';

import { NoteEditDialog } from '../components/notes/NoteEditDialog';
import type { Note, NoteKind, RefEntityKind } from '../model/types';
import { useTripData } from './TripDataContext';

export type NoteTarget =
  | { mode: 'create'; entity: RefEntityKind; id: string; kind: NoteKind }
  | { mode: 'edit'; note: Note };

interface NoteEditContextValue {
  openNoteCreate: (entity: RefEntityKind, id: string, kind: NoteKind) => void;
  openNoteEdit: (note: Note) => void;
}

const NoteEditContext = createContext<NoteEditContextValue | null>(null);

// Mirrors EditContext's own shape (a target + a dialog mounted once here),
// kept separate because a Note's create/edit/delete flow is genuinely
// different from Activity/Stay/Transit's: concerns is fixed at creation
// (see NoteEditDialog) rather than built from a full form, so there's no
// shared form-state machinery worth merging the two contexts over.
export function NoteEditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [target, setTarget] = useState<NoteTarget | null>(null);

  const openNoteCreate = (entity: RefEntityKind, id: string, kind: NoteKind) =>
    setTarget({ mode: 'create', entity, id, kind });
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
            concerns: [{ entity: target.entity, id: target.id }],
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

export function useNoteEdit(): NoteEditContextValue {
  const ctx = useContext(NoteEditContext);
  if (!ctx) throw new Error('useNoteEdit must be used within a NoteEditProvider');
  return ctx;
}
