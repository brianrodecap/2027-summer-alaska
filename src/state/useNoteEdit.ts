import { useContext } from 'react';

import { NoteEditContext, type NoteEditContextValue } from './NoteEditContextObject';

export function useNoteEdit(): NoteEditContextValue {
  const ctx = useContext(NoteEditContext);
  if (!ctx) throw new Error('useNoteEdit must be used within a NoteEditProvider');
  return ctx;
}
