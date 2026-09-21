import { useState } from 'react';

import { applyRouteForm, routeFormFrom } from '../../model/editForms';
import type { Route } from '../../model/types';
import { EntityFormDialog } from '../shared/EntityFormDialog';
import { RouteEditForm } from './RouteEditForm';

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

  const handleSave = (): string | null => {
    const clone = structuredClone(route);
    const message = applyRouteForm(clone, form);
    if (!message) onSave(clone);
    return message;
  };

  return (
    <EntityFormDialog
      title={isNew ? 'Add route' : 'Edit route'}
      onClose={onClose}
      onSubmit={handleSave}
      deletion={
        isNew
          ? undefined
          : {
              title: 'Delete this route?',
              message:
                "This can't be undone from the app — it removes the route entirely, including all its variants.",
              onConfirm: () => onDelete(route._id),
            }
      }
    >
      <RouteEditForm form={form} onChange={setForm} />
    </EntityFormDialog>
  );
}
