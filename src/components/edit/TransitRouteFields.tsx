import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import {
  routeSelectOptions,
  routeVariantOptions,
  type TransitFormState,
} from '../../model/editForms';
import { formatMinutes } from '../../model/formatting';
import { variantColor, variantSummary } from '../../model/routePlanner';
import { isReverseDrive } from '../../model/routeReverse';
import { directVariantId, pickVariant } from '../../model/tripModel';
import type { Route } from '../../model/types';
import { useTripEdits } from '../daysview/useTripEdits';
import { LabelWithTip } from '../shared/LabelWithTip';
import { materialIcon } from '../shared/materialIcon';
import { RoutesDialog } from './RoutesDialog';

const NearMeIcon = materialIcon('near_me');

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
  const { saveRoute, deleteRoute } = useTripEdits();
  const [plannerOpen, setPlannerOpen] = useState(false);
  const selectedRoute = routes.find((r) => r._id === form.routeId) ?? null;
  const { palette } = useTheme();
  // A chosen route can always be opened; without one, the drive's two places must be known.
  const canPlan = !!selectedRoute || (!!form.from.id && !!form.to.id);
  // The places the planner works from: the drive's own, else the route's.
  const driveFrom = form.from.id || !selectedRoute ? form.from : selectedRoute.from;
  const driveTo = form.to.id || !selectedRoute ? form.to : selectedRoute.to;
  // The variant the drive follows: the one named, else the route's direct one.
  const chosen = (selectedRoute && pickVariant(selectedRoute.variants, form.routeVariant)) ?? null;
  return (
    <>
      <TextField
        select
        label="Route"
        value={form.routeId ?? ''}
        helperText={
          selectedRoute && isReverseDrive(selectedRoute, form) ? 'Driven in reverse' : undefined
        }
        onChange={(e) => {
          const routeId = e.target.value || null;
          const route = routes.find((r) => r._id === routeId);
          onChange({ ...form, routeId, routeVariant: directVariantId(route) });
        }}
      >
        {routeSelectOptions(routes).map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: 'center',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.5,
          py: 0.75,
        }}
      >
        {chosen ? (
          <>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                flexShrink: 0,
                bgcolor: variantColor(
                  palette.routeVariants,
                  selectedRoute!.variants,
                  selectedRoute!.variants.indexOf(chosen),
                ),
              }}
            />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {chosen.label} · {formatMinutes(variantSummary(chosen).minutes)}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            No route chosen
          </Typography>
        )}
        <Tooltip title={canPlan ? '' : 'Choose the From and To places first, or pick a route.'}>
          <span>
            <Button
              size="small"
              disabled={!canPlan}
              startIcon={<NearMeIcon />}
              onClick={() => setPlannerOpen(true)}
            >
              {selectedRoute ? 'Open planner' : 'Plan route'}
            </Button>
          </span>
        </Tooltip>
      </Stack>
      <RoutesDialog
        routes={routes}
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        onSave={saveRoute}
        onDelete={deleteRoute}
        drive={{
          from: driveFrom,
          to: driveTo,
          routeId: form.routeId,
          variantId: form.routeVariant,
          onUse: (route, variantId) =>
            onChange({ ...form, routeId: route._id, routeVariant: variantId }),
        }}
      />
      {selectedRoute && (
        <>
          <TextField
            select
            label="Route variant"
            value={chosen?.id ?? ''}
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
