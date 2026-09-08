import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';

import type { StayFormState } from '../../model/editForms';
import { BookingFields } from './BookingFields';
import { LodgingField, StayWhenFields } from './StayTransitFields';

export function StayEditForm({
  form,
  onChange,
}: {
  form: StayFormState;
  onChange: (form: StayFormState) => void;
}) {
  return (
    <Stack spacing={2}>
      <LodgingField form={form} onChange={onChange} />
      <StayWhenFields form={form} onChange={onChange} />
      <Divider />
      <BookingFields value={form.booking} onChange={(booking) => onChange({ ...form, booking })} />
    </Stack>
  );
}
