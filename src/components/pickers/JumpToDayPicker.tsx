import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useRef } from 'react';

import type { DayFrame } from '../../model/types';

// dayjs objects are constructed/read only at this component's own boundary —
// tripModel.ts does all date math on plain ISO strings to dodge timezone
// drift, so nothing here ever hands a dayjs object back across that line.
function toIsoDate(value: Dayjs): string {
  return value.format('YYYY-MM-DD');
}

// A docked month-grid calendar for picking a trip day ("Jump to a day", and the
// Move action's target); only dates that land on an actual trip Day are
// selectable unless `anyDate`. `notes` are shown above the calendar, before a day is picked.
export function JumpToDayPicker({
  open,
  onClose,
  days,
  tripStart,
  tripEnd,
  onSelectDay,
  title = 'Jump to a day',
  notes = [],
  initialDate,
  anyDate = false,
}: {
  open: boolean;
  onClose: () => void;
  days: DayFrame[];
  tripStart: string;
  tripEnd: string;
  onSelectDay: (date: string) => void;
  title?: string;
  notes?: string[];
  // The month first shown; the first trip day when absent.
  initialDate?: string;
  // Any calendar date can be picked, not only the trip's days.
  anyDate?: boolean;
}) {
  const validDates = useMemo(() => new Set(days.map((d) => d.date)), [days]);

  // Navigating (and so scrolling the day list) immediately on pick would
  // race MUI's own Modal scroll-lock: it holds `overflow: hidden` on
  // <body> for the duration of the Dialog's exit transition, so a
  // scrollIntoView fired synchronously with the pick can silently no-op or
  // land mid-transition — the mobile "jump to a day lands on blank space"
  // bug. Modal's internal onExited (which releases the lock) runs
  // synchronously right after `onTransitionExited` fires, and React defers
  // this component's own effects until after that — so triggering
  // onSelectDay from `onTransitionExited` still lands after the lock is
  // gone by the time DaysView's scroll effect actually runs. (The
  // transition child's own onExited prop isn't usable for this: Modal
  // clones its own handler onto that element, clobbering anything set via
  // slotProps.transition.)
  const pendingDateRef = useRef<string | null>(null);

  return (
    // DateCalendar's inner root is a fixed 320px wide, overflow:hidden box
    // (@mui/x-date-pickers' own DIALOG_WIDTH constant) that doesn't shrink
    // to fit a narrower container. MUI's default Dialog margin (32px a
    // side) leaves less than that on most phones (e.g. 375px screens get
    // only 311px), clipping the calendar's rightmost column and the
    // month-nav arrow. Shrinking the margin to 8px keeps it clear of that
    // cutoff down to ~336px-wide screens.
    <Dialog
      open={open}
      onClose={onClose}
      sx={{ '& .MuiDialog-paper': { mx: 1, maxWidth: 'calc(100% - 16px)' } }}
      onTransitionExited={() => {
        if (!pendingDateRef.current) return;
        onSelectDay(pendingDateRef.current);
        pendingDateRef.current = null;
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {notes.map((note) => (
          <Alert key={note} severity="info" sx={{ mx: 2, mb: 1 }}>
            {note}
          </Alert>
        ))}
        <DateCalendar
          defaultValue={dayjs(initialDate ?? days[0]?.date ?? tripStart, 'YYYY-MM-DD')}
          minDate={anyDate ? undefined : dayjs(tripStart, 'YYYY-MM-DD')}
          maxDate={anyDate ? undefined : dayjs(tripEnd, 'YYYY-MM-DD')}
          shouldDisableDate={
            anyDate ? undefined : (value) => !validDates.has(toIsoDate(value as Dayjs))
          }
          onChange={(value) => {
            if (!value) return;
            pendingDateRef.current = toIsoDate(value as Dayjs);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
