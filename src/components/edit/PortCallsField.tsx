import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { PortCall } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { PlacePickerField } from './PlacePickerField';
import { rowList } from './rowList';

const DeleteIcon = materialIcon('delete');

// One local date-time edited as the picker pair's date and time halves. A
// half picked before the other is held here until both are set, so picking
// the date first doesn't lose it to a still-empty time.
function DateTimeValue({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [date, setDate] = useState(value ? value.slice(0, 10) : null);
  const [time, setTime] = useState(value ? value.slice(11, 16) : null);
  // The value changed from outside (another stay opened in this form, a draft
  // applied): take it, unless it's just what the two halves already say.
  // Compared to the minute: a stored time with seconds ('…T15:00:00') would
  // never equal the composed one, and this would reset on every render.
  const composed = date && time ? `${date}T${time}` : null;
  if ((value?.slice(0, 16) ?? null) !== composed) {
    setDate(value ? value.slice(0, 10) : null);
    setTime(value ? value.slice(11, 16) : null);
  }
  const update = (nextDate: string | null, nextTime: string | null) => {
    setDate(nextDate);
    setTime(nextTime);
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : null);
  };
  return (
    <DateTimeFieldPair
      dateLabel={label}
      timeLabel="Time"
      dateValue={date}
      timeValue={time}
      onDateChange={(d) => update(d, time)}
      onTimeChange={(t) => update(date, t)}
    />
  );
}

// A cruise cabin's stops (Stay.portCalls): each port, or a glacier the ship
// cruises past, with when the ship arrives and when it leaves — all aboard.
// A stay with none shows just the "Add" button, so a hotel's form stays as
// short as before.
export function PortCallsField({
  portCalls,
  onChange,
}: {
  portCalls: PortCall[];
  onChange: (portCalls: PortCall[]) => void;
}) {
  const { updateAt, removeAt, add } = rowList(portCalls, onChange);
  // Counts the removals: a row that follows a removed one shifts index, so its
  // half-entered time would land on the wrong stop unless the rows remount.
  // Adding at the end shifts nothing, so it keeps what's half entered.
  const [removals, setRemovals] = useState(0);

  return (
    <Stack spacing={1.5}>
      {portCalls.length > 0 && <Typography variant="subtitle2">Ports of call</Typography>}
      {portCalls.map((call, index) => (
        // A port call has no id, so its row is keyed by position and removals.
        <Stack spacing={1} key={`${index}-${removals}`}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Stop"
              value={call.kind}
              onChange={(e) => updateAt(index, { kind: e.target.value as PortCall['kind'] })}
              sx={{ width: 160, flexShrink: 0 }}
            >
              <MenuItem value="port">In port</MenuItem>
              <MenuItem value="scenic">Cruising past</MenuItem>
            </TextField>
            <PlacePickerField
              label="Port"
              place={call.place}
              onChange={(place) => updateAt(index, { place: place ?? { id: null, label: '' } })}
            />
            <IconButton
              aria-label="Remove"
              onClick={() => {
                setRemovals((n) => n + 1);
                removeAt(index);
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
          <DateTimeValue
            label="Arrives"
            value={call.arrivesAt}
            onChange={(arrivesAt) => updateAt(index, { arrivesAt })}
          />
          <DateTimeValue
            label={call.kind === 'port' ? 'All aboard' : 'Leaves'}
            value={call.departsAt}
            onChange={(departsAt) => updateAt(index, { departsAt })}
          />
        </Stack>
      ))}
      <Button
        size="small"
        onClick={() =>
          add({ kind: 'port', place: { id: null, label: '' }, arrivesAt: null, departsAt: null })
        }
        sx={{ alignSelf: 'flex-start' }}
      >
        Add a port of call
      </Button>
    </Stack>
  );
}
