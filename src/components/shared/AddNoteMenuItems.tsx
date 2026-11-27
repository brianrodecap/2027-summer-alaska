import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import type { MouseEvent } from 'react';

import { materialIcon } from './materialIcon';

const NoteAddIcon = materialIcon('note_add');

// A row menu's one "Add note" item. The note dialog it opens is where the kind
// (alert, info, footnote) is picked.
export function AddNoteMenuItem({ onClick }: { onClick: (e: MouseEvent) => void }) {
  return (
    <MenuItem onClick={onClick}>
      <ListItemIcon>
        <NoteAddIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>Add note</ListItemText>
    </MenuItem>
  );
}
