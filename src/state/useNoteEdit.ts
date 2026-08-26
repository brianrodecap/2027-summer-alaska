import { useRequiredContext } from './contextHook';
import { NoteEditContext, type NoteEditContextValue } from './NoteEditContextObject';

export function useNoteEdit(): NoteEditContextValue {
  return useRequiredContext(NoteEditContext, 'useNoteEdit must be used within a NoteEditProvider');
}
