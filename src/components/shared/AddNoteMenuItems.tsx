import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import type { MouseEvent } from 'react';

import type { NoteKind } from '../../model/types';
import { ADD_NOTE_ITEMS, NOTE_ICON } from './noteKind';

// The "add a note" menu items shared by every entry point that opens one —
// a row's own kebab menu (RowMenu) and the day-level note button (DayBlock)
// — so the three kinds always render with the same label/icon/order. Each
// caller supplies its own click handler (already wrapping stopPropagation +
// menu-close, see RowMenu's/DayBlock's own `pick` helper) rather than this
// component owning any menu-open state itself.
export function AddNoteMenuItems({
  onPick,
}: {
  onPick: (kind: NoteKind) => (e: MouseEvent) => void;
}) {
  return (
    <>
      {ADD_NOTE_ITEMS.map(({ kind, label }) => {
        const Icon = NOTE_ICON[kind];
        return (
          <MenuItem key={kind} onClick={onPick(kind)}>
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        );
      })}
    </>
  );
}
