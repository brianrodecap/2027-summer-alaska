import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  routeSelectOptions,
  routeVariantOptions,
  type TransitFormState,
} from '../../model/editForms';
import type { Route } from '../../model/types';
import { BookingFields } from './BookingFields';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { TransitEndpointFields } from './StayTransitFields';

export function TransitEditForm({
  form,
  onChange,
  routes,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
  routes: Route[];
}) {
  const selectedRoute = routes.find((r) => r._id === form.routeId) ?? null;
  const hasRoute = Boolean(form.routeId);

  return (
    <Stack spacing={2}>
      <TransitEndpointFields form={form} onChange={onChange} />
      <DateTimeFieldPair
        dateLabel="Departs date"
        timeLabel="Departs time"
        dateValue={form.departsDate}
        timeValue={form.departsTime}
        onDateChange={(v) => onChange({ ...form, departsDate: v })}
        onTimeChange={(v) => onChange({ ...form, departsTime: v })}
      />
      {!hasRoute && (
        <DateTimeFieldPair
          dateLabel="Arrives date"
          timeLabel="Arrives time"
          dateValue={form.arrivesDate}
          timeValue={form.arrivesTime}
          onDateChange={(v) => onChange({ ...form, arrivesDate: v })}
          onTimeChange={(v) => onChange({ ...form, arrivesTime: v })}
        />
      )}
      {hasRoute && (
        <Typography variant="body2" color="text.secondary">
          Arrival is computed from the selected route's own drive times, updated live as it's
          picked.
        </Typography>
      )}
      <TextField
        select
        label="Route"
        value={form.routeId ?? ''}
        onChange={(e) => {
          const routeId = e.target.value || null;
          const route = routes.find((r) => r._id === routeId) ?? null;
          onChange({ ...form, routeId, routeVariant: route?.variants[0]?.tone ?? null });
        }}
      >
        {routeSelectOptions(routes).map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {selectedRoute && (
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
      )}
      <Divider />
      <BookingFields value={form.booking} onChange={(booking) => onChange({ ...form, booking })} />
    </Stack>
  );
}
