import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { type MouseEvent, useState } from 'react';

import type { NoteKind, RefEntityKind } from '../../model/types';
import { useNoteEdit } from '../../state/NoteEditContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { NOTE_ICON } from '../shared/Notes';

const ADD_NOTE_ITEMS: { kind: NoteKind; label: string }[] = [
  { kind: 'warning', label: 'Add alert' },
  { kind: 'info', label: 'Add info' },
  { kind: 'footnote', label: 'Add footnote' },
];

// A row's action menu — a plain kebab IconButton that opens a standard MUI
// dropdown Menu, rather than a SpeedDial's fanned-out Fab. It sits inline as
// a normal flex sibling of the row's own content (see DayTimeline.tsx's
// callers), never absolutely overlapping it, so long row text can never be
// covered by the button the way a floating Fab could. Delete goes through
// its own ConfirmDialog rather than firing straight from the menu item —
// same rule as every other delete path in the app (EditDialog,
// RouteEditDialog, NoteEditDialog).
export function RowMenu({
  entity,
  id,
  onEdit,
  onDelete,
}: {
  entity: RefEntityKind;
  id: string;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { openNoteCreate } = useNoteEdit();

  const pick = (action: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    action();
    setAnchorEl(null);
  };

  return (
    <>
      <IconButton
        aria-label="Row actions"
        size="small"
        sx={{ flexShrink: 0, ml: 0.5, mt: -0.5 }}
        onClick={(e) => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={pick(onEdit)}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        {onDelete && (
          <MenuItem onClick={pick(() => setConfirmingDelete(true))}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        )}
        {ADD_NOTE_ITEMS.map(({ kind, label }) => {
          const Icon = NOTE_ICON[kind];
          return (
            <MenuItem key={kind} onClick={pick(() => openNoteCreate(entity, id, kind))}>
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
      {onDelete && (
        <ConfirmDialog
          open={confirmingDelete}
          title={`Delete this ${entity}?`}
          message="This can't be undone from the app — it removes the entry entirely."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
