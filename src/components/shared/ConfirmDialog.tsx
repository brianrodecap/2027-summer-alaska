import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

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
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
