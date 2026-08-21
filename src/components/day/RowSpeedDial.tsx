import Box from '@mui/material/Box';
import SpeedDial from '@mui/material/SpeedDial';
import SpeedDialAction from '@mui/material/SpeedDialAction';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import EditIcon from '@mui/icons-material/Edit';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';

import { useNoteEdit } from '../../state/NoteEditContext';
import type { RefEntityKind } from '../../model/types';

// A row's action menu — long-press summons it (see useLongPress), a plain
// tap on the row opens its detail dialog instead. Only mounted while open,
// so nothing about a row's resting appearance changes; closing (via
// SpeedDial's own backdrop-click/Escape handling, or picking an action)
// unmounts it again.
export function RowSpeedDial({
  entity,
  id,
  onEdit,
  onClose,
}: {
  entity: RefEntityKind;
  id: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { openNoteCreate } = useNoteEdit();

  const pick = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}>
      <SpeedDial
        ariaLabel="Row actions"
        icon={<MoreHorizIcon />}
        open
        onClose={onClose}
        direction="left"
        FabProps={{ size: 'small' }}
        sx={{ '& .MuiSpeedDial-fab': { width: 32, height: 32, minHeight: 32 } }}
      >
        <SpeedDialAction icon={<EditIcon fontSize="small" />} slotProps={{ tooltip: { title: 'Edit' } }} onClick={pick(onEdit)} />
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
    </Box>
  );
}
