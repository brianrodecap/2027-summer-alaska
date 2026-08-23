import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

// A fixed, real-world-sized set of options rather than a free end time —
// 15/30/45 minutes for short activities, 30-minute steps out to 4 hours,
// then hour steps out to a 12-hour ceiling (the longest anything in this
// trip actually runs today is 9 hours). Activity.durationMinutes itself
// stays a plain number (or null), so a value saved before this list existed
// still round-trips even if it isn't one of these exact options.
const DURATION_MINUTES_OPTIONS = [
  15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 540, 600, 660, 720,
];

function formatDurationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function DurationSelect({
  label = 'Duration',
  value,
  onChange,
}: {
  label?: string;
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  // A stored value outside the fixed list (e.g. migrated from an old
  // startAt/endAt pair, or set by the AI document import before rounding)
  // still needs a selectable option of its own, rather than silently
  // snapping to something else the moment the dialog opens.
  const options =
    value != null && !DURATION_MINUTES_OPTIONS.includes(value)
      ? [...DURATION_MINUTES_OPTIONS, value].sort((a, b) => a - b)
      : DURATION_MINUTES_OPTIONS;

  return (
    <TextField
      select
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <MenuItem value="">None</MenuItem>
      {options.map((minutes) => (
        <MenuItem key={minutes} value={minutes}>
          {formatDurationLabel(minutes)}
        </MenuItem>
      ))}
    </TextField>
  );
}
