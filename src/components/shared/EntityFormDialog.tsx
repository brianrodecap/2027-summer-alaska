import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { type ReactNode, useState } from 'react';

import { ConfirmableDeleteButton } from './ConfirmableDeleteButton';

// The one modal shell every "edit a single entity" dialog shares (Activity/
// Stay/Transit, Route, Scenario, Leg): title, an error banner, a scrollable
// form body, and a Cancel/Save row with an optional confirmed Delete on the
// left. Each caller keeps only its own form fields and its own apply step.
//
// `onSubmit` is that apply step: it validates/applies the caller's form and,
// on success, hands the result to the caller's own onSave itself — returning
// null. A returned string is a validation message, shown in the banner
// instead of closing. Omit `deletion` for a dialog with nothing to delete
// (a brand-new entity, or a kind that can't be removed from here).
export function EntityFormDialog({
  title,
  saveLabel = 'Save',
  onClose,
  onSubmit,
  deletion,
  children,
}: {
  title: string;
  saveLabel?: string;
  onClose: () => void;
  onSubmit: () => string | null;
  deletion?: {
    title: string;
    message: string;
    onConfirm: () => void;
    blockedReason?: string | null;
  };
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {children}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        {deletion ? <ConfirmableDeleteButton {...deletion} /> : <span />}
        <div>
          <Button onClick={onClose} data-testid="edit-dialog-cancel">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => setError(onSubmit())}
            data-testid="edit-dialog-save"
          >
            {saveLabel}
          </Button>
        </div>
      </DialogActions>
    </Dialog>
  );
}
