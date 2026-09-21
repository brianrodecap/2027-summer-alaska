import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { SxProps, Theme } from '@mui/material/styles';
import { useState } from 'react';

import { ConfirmDialog } from './ConfirmDialog';

// A Delete button that only ever *asks* — clicking it opens ConfirmDialog,
// and `onConfirm` fires only once that's confirmed. Shared by every edit
// dialog with a Delete action (EntityFormDialog, NoteEditDialog) so the
// "never delete a real data entity without a confirmation" rule lives in one
// place instead of each dialog re-wiring its own confirmingDelete state. A
// `blockedReason` (the entity can't be deleted right now — see
// scenarioDeletionBlocker) turns the click into an explanation instead of a
// confirmation.
export function ConfirmableDeleteButton({
  title,
  message,
  onConfirm,
  blockedReason,
  label = 'Delete',
  sx,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  blockedReason?: string | null;
  label?: string;
  sx?: SxProps<Theme>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        color="error"
        onClick={() => setConfirming(true)}
        sx={sx}
        data-testid="edit-dialog-delete"
      >
        {label}
      </Button>
      <Dialog open={confirming && Boolean(blockedReason)} onClose={() => setConfirming(false)}>
        <DialogTitle>Can&apos;t delete this yet</DialogTitle>
        <DialogContent>
          <DialogContentText>{blockedReason}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>OK</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirming && !blockedReason}
        title={title}
        message={message}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}
