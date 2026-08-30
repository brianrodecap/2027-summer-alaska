import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { MouseEvent } from 'react';

// MUI portals Dialog content to document.body, but React's synthetic events
// still bubble through the component tree — so without this, a click on
// either button also reaches whatever row/menu opened the dialog.
const stop =
  (fn: () => void) =>
  (e: MouseEvent): void => {
    e.stopPropagation();
    fn();
  };

// Shared "are you sure?" gate for destructive actions — currently just the
// Activity/Stay/Transit and Route edit dialogs' own Delete buttons.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={stop(onCancel)}>Cancel</Button>
        <Button color="error" variant="contained" onClick={stop(onConfirm)}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
