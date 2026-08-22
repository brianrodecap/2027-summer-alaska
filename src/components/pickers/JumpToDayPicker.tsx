import CloseIcon from '@mui/icons-material/Close';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo } from 'react';

import type { Day } from '../../model/types';

// dayjs objects are constructed/read only at this component's own boundary —
// tripModel.ts does all date math on plain ISO strings to dodge timezone
// drift, so nothing here ever hands a dayjs object back across that line.
function toIsoDate(value: Dayjs): string {
  return value.format('YYYY-MM-DD');
}

// The "Jump to a day" control — a docked month-grid calendar; only dates
// that land on an actual trip Day are selectable, matching the old app's
// hand-built date-picker.js. @mui/x-date-pickers' DateCalendar is a direct,
// built-in replacement for that hand-rolled month-grid math.
export function JumpToDayPicker({
  open,
  onClose,
  days,
  tripStart,
  tripEnd,
  onSelectDay,
}: {
  open: boolean;
  onClose: () => void;
  days: Day[];
  tripStart: string;
  tripEnd: string;
  onSelectDay: (date: string) => void;
}) {
  const validDates = useMemo(() => new Set(days.map((d) => d.date)), [days]);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Jump to a day
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <DateCalendar
          defaultValue={dayjs(days[0]?.date ?? tripStart, 'YYYY-MM-DD')}
          minDate={dayjs(tripStart, 'YYYY-MM-DD')}
          maxDate={dayjs(tripEnd, 'YYYY-MM-DD')}
          shouldDisableDate={(value) => !validDates.has(toIsoDate(value as Dayjs))}
          onChange={(value) => {
            if (!value) return;
            onSelectDay(toIsoDate(value as Dayjs));
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
