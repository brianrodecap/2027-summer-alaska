import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';

import {
  routeSelectOptions,
  routeVariantOptions,
  type TransitFormState,
} from '../../model/editForms';
import { DEFAULT_ROUTE_TONE } from '../../model/tripModel';
import type { Route } from '../../model/types';
import { LabelWithTip } from '../shared/LabelWithTip';

// The route picker, its variant picker, and the routed drive's own
// show-endpoints-on-maps opt-in (see tripModel.ts's transitPhaseOnMap) —
// shared by TransitEditForm and the wizard's TransitRouteStep so the two
// can't drift apart.
export function TransitRouteFields({
  form,
  onChange,
  routes,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
  routes: Route[];
}) {
  const selectedRoute = routes.find((r) => r._id === form.routeId) ?? null;
  return (
    <>
      <TextField
        select
        label="Route"
        value={form.routeId ?? ''}
        onChange={(e) => {
          const routeId = e.target.value || null;
          onChange({ ...form, routeId, routeVariant: routeId ? DEFAULT_ROUTE_TONE : null });
        }}
      >
        {routeSelectOptions(routes).map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {selectedRoute && (
        <>
          <TextField
            select
            label="Route variant"
            value={form.routeVariant ?? ''}
            onChange={(e) => onChange({ ...form, routeVariant: e.target.value || null })}
          >
            {routeVariantOptions(selectedRoute).map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={form.showEndpointsOnMap}
                onChange={(e) => onChange({ ...form, showEndpointsOnMap: e.target.checked })}
              />
            }
            label={
              <LabelWithTip
                text="Show start and end on maps"
                tip="Off by default: a drive's start and end are usually a whole city or park, so maps and drive totals use the route's own stops instead."
              />
            }
          />
        </>
      )}
    </>
  );
}
