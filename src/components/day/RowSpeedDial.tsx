import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import InfoIcon from '@mui/icons-material/Info';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import NotesIcon from '@mui/icons-material/Notes';
import WarningIcon from '@mui/icons-material/Warning';
import Box from '@mui/material/Box';
import SpeedDial from '@mui/material/SpeedDial';
import SpeedDialAction from '@mui/material/SpeedDialAction';
import { type MouseEvent, useState } from 'react';

import type { RefEntityKind } from '../../model/types';
import { useNoteEdit } from '../../state/NoteEditContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';

// A row's action menu — a normal MUI SpeedDial (hover/click its own small FAB
// to open, like any other SpeedDial), sitting at the row's own top-right
// corner. Even closed, MUI lays out the (invisible) actions strip at full
// width so it can animate open — SpeedDial handles this internally with
// `pointer-events: none` on its root and `auto` only on the Fab/open actions,
// letting clicks over the invisible strip fall through to the row underneath.
// Our own wrapping Box has to repeat that same none/auto split (rather than
// just capturing everything itself), or that invisible strip becomes a large
// dead zone swallowing taps on the row — most of a narrow mobile row's width,
// which is what made rows seem untappable there. Delete goes through its own
// ConfirmDialog rather than firing straight from the SpeedDialAction — same
// rule as every other delete path in the app (EditDialog, RouteEditDialog,
// NoteEditDialog).
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
    <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 1, pointerEvents: 'none' }}>
      <SpeedDial
        ariaLabel="Row actions"
        icon={<MoreHorizIcon />}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        direction="left"
        FabProps={{ size: 'small', onClick: (e) => e.stopPropagation() }}
        sx={{ '& .MuiSpeedDial-fab': { width: 32, height: 32, minHeight: 32 } }}
      >
        <SpeedDialAction
          icon={<EditIcon fontSize="small" />}
          slotProps={{ tooltip: { title: 'Edit' } }}
          onClick={pick(onEdit)}
        />
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
