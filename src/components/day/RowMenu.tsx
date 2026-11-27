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
import { AddNoteMenuItem } from '../shared/AddNoteMenuItems';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { materialIcon } from '../shared/materialIcon';
import { DEFAULT_NOTE_KIND } from '../shared/noteKind';
import { useAnchorMenu } from '../shared/useAnchorMenu';

const EventIcon = materialIcon('event');

// A card's action menu — a plain kebab IconButton in the card's top corner that
// opens a standard MUI dropdown Menu. It takes its own place in the card's header,
// so long row text can never be covered by it. Delete goes through its own
// ConfirmDialog rather than firing straight from the menu item — same rule as
// every other delete path in the app (EditDialog, RouteEditDialog,
// NoteEditDialog).
export function RowMenu({
  entity,
  id,
  onEdit,
  onMove,
  onDelete,
}: {
  entity: RefEntityKind;
  id: string;
  onEdit: () => void;
  // Only for rows that can move to another day (an Activity, a Transit).
  onMove?: () => void;
  onDelete?: () => void;
}) {
  const { anchorEl, openAt, close, pick } = useAnchorMenu();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { openNoteCreate } = useNoteEdit();

  return (
    <>
      <IconButton
        aria-label="Row actions"
        data-testid={`row-menu-${entity}-${id}`}
        size="small"
        sx={{ m: -0.5 }}
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
        <AddNoteMenuItem onClick={pick(() => openNoteCreate({ entity, id }, DEFAULT_NOTE_KIND))} />
        {onMove && (
          <MenuItem onClick={pick(onMove)}>
            <ListItemIcon>
              <EventIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Move to another day…</ListItemText>
          </MenuItem>
        )}
        {onDelete && (
          <MenuItem onClick={pick(() => setConfirmingDelete(true))}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        )}
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
