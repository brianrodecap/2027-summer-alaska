import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { TransitFormState } from '../../model/editForms';
import type { Route } from '../../model/types';
import { BookingFields } from './BookingFields';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { TransitEndpointFields } from './StayTransitFields';
import { TransitRouteFields } from './TransitRouteFields';

export function TransitEditForm({
  form,
  onChange,
  routes,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
  routes: Route[];
}) {
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
      <TransitRouteFields form={form} onChange={onChange} routes={routes} />
      <Divider />
      <BookingFields value={form.booking} onChange={(booking) => onChange({ ...form, booking })} />
    </Stack>
  );
}
