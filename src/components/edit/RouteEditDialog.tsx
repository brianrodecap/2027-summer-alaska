import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';

import { RouteEditForm } from './RouteEditForm';
import { routeFormFrom, applyRouteForm } from '../../model/editForms';
import type { Route } from '../../model/types';

// The chrome around RouteEditForm — mirrors EditDialog's own Save/Cancel/
// Delete shape, but stands apart from EditContext/EditDialog since a Route
// isn't a day-list line item scoped to one entity id (see RoutesDialog's own
// note): its Save/Delete instead go straight back to whichever caller is
// managing routes.json.
export function RouteEditDialog({
  route,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  route: Route;
  isNew: boolean;
  onClose: () => void;
  onSave: (route: Route) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<Route>(() => routeFormFrom(route));
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const clone = structuredClone(route);
    const message = applyRouteForm(clone, form);
    if (message) {
      setError(message);
      return;
    }
    onSave(clone);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Add route' : 'Edit route'}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <RouteEditForm form={form} onChange={setForm} />
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        {isNew ? <span /> : (
          <Button color="error" onClick={() => onDelete(route._id)}>
            Delete
          </Button>
        )}
        <div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogActions>
    </Dialog>
  );
}
