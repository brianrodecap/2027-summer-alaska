import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';

import type { RefEntityKind } from '../../model/types';
import { useNoteEdit } from '../../state/useNoteEdit';
import { AddNoteMenuItems } from '../shared/AddNoteMenuItems';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useAnchorMenu } from '../shared/useAnchorMenu';

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
  const { anchorEl, openAt, close, pick } = useAnchorMenu();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { openNoteCreate } = useNoteEdit();

  return (
    <>
      <IconButton
        aria-label="Row actions"
        size="small"
        edge="end"
        sx={{ flexShrink: 0, ml: 0.5, mt: -0.5 }}
        onClick={openAt}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={close}>
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
        <AddNoteMenuItems onPick={(kind) => pick(() => openNoteCreate({ entity, id }, kind))} />
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
