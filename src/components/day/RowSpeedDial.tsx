import { useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import SpeedDial from '@mui/material/SpeedDial';
import SpeedDialAction from '@mui/material/SpeedDialAction';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';

import { useNoteEdit } from '../../state/NoteEditContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { RefEntityKind } from '../../model/types';

// A row's action menu — a normal MUI SpeedDial (hover/click its own small FAB
// to open, like any other SpeedDial), sitting at the row's own top-right
// corner. Its own click is stopped from bubbling so opening it or picking an
// action never also triggers the row's separate tap-to-open-detail-dialog
// handler. Delete goes through its own ConfirmDialog rather than firing
// straight from the SpeedDialAction — same rule as every other delete path
// in the app (EditDialog, RouteEditDialog, NoteEditDialog).
export function RowSpeedDial({
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
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { openNoteCreate } = useNoteEdit();

  const pick = (action: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    action();
    setOpen(false);
  };

  return (
    <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
      <SpeedDial
        ariaLabel="Row actions"
        icon={<MoreHorizIcon />}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        direction="left"
        FabProps={{ size: 'small' }}
        sx={{ '& .MuiSpeedDial-fab': { width: 32, height: 32, minHeight: 32 } }}
      >
        <SpeedDialAction icon={<EditIcon fontSize="small" />} slotProps={{ tooltip: { title: 'Edit' } }} onClick={pick(onEdit)} />
        {onDelete && (
          <SpeedDialAction
            icon={<DeleteIcon fontSize="small" />}
            slotProps={{ tooltip: { title: 'Delete' } }}
            onClick={pick(() => setConfirmingDelete(true))}
          />
        )}
        <SpeedDialAction
          icon={<WarningIcon fontSize="small" />}
          slotProps={{ tooltip: { title: 'Add alert' } }}
          onClick={pick(() => openNoteCreate(entity, id, 'warning'))}
        />
        <SpeedDialAction
          icon={<InfoIcon fontSize="small" />}
          slotProps={{ tooltip: { title: 'Add info' } }}
          onClick={pick(() => openNoteCreate(entity, id, 'info'))}
        />
        <SpeedDialAction
          icon={<NotesIcon fontSize="small" />}
          slotProps={{ tooltip: { title: 'Add footnote' } }}
          onClick={pick(() => openNoteCreate(entity, id, 'footnote'))}
        />
      </SpeedDial>
      {onDelete && (
        <ConfirmDialog
          open={confirmingDelete}
          title={`Delete this ${entity}?`}
          message="This can't be undone from the app — it removes the entry entirely."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </Box>
  );
}
