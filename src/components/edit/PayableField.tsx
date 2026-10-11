import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import type { Payable } from '../../model/types';
import { DateStringField } from './DateTimeFieldPair';

type Choice = 'paid' | 'paidAt' | 'atProperty' | 'dueBy';

function choiceOf(payable: Payable | undefined): Choice {
  if (!payable) return 'paid';
  if (payable === 'atProperty') return 'atProperty';
  return 'dueBy' in payable ? 'dueBy' : 'paidAt';
}

// When a price is paid (see Payable): already (optionally on a date), at the
// property, or by a date. Shared by the booking form's price fields and each
// package row, so the choices read the same everywhere. A date stays blank until
// picked; Save treats a blank one as paid (storedPayable in bookingFormValue).
export function PayableField({
  value,
  onChange,
  size,
}: {
  value: Payable | undefined;
  onChange: (value: Payable | undefined) => void;
  size?: 'small' | 'medium';
}) {
  const choice = choiceOf(value);
  const date =
    value && value !== 'atProperty' ? ('dueBy' in value ? value.dueBy : value.paidAt) : '';
  return (
    <Stack direction="row" spacing={2} sx={{ flex: 1, minWidth: 0 }}>
      <TextField
        select
        label="Payment"
        value={choice}
        size={size}
        onChange={(e) => {
          const next = e.target.value as Choice;
          if (next === 'paid') onChange(undefined);
          else if (next === 'atProperty') onChange('atProperty');
          // The date already picked carries over between "due by" and "paid on".
          else onChange(next === 'dueBy' ? { dueBy: date } : { paidAt: date });
        }}
        fullWidth
      >
        <MenuItem value="paid">Paid</MenuItem>
        <MenuItem value="paidAt">Paid on a date</MenuItem>
        <MenuItem value="atProperty">At the property</MenuItem>
        <MenuItem value="dueBy">Due by a date</MenuItem>
      </TextField>
      {choice === 'dueBy' && (
        <DateStringField
          label="Due by"
          value={date || null}
          onChange={(next) => onChange({ dueBy: next ?? '' })}
        />
      )}
      {choice === 'paidAt' && (
        <DateStringField
          label="Paid on"
          value={date || null}
          onChange={(next) => onChange({ paidAt: next ?? '' })}
        />
      )}
    </Stack>
  );
}
