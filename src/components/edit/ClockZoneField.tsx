import Autocomplete from '@mui/material/Autocomplete';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { zoneLabel } from '../../model/formatting';
import { LabelWithTip } from '../shared/LabelWithTip';

// Every zone the browser knows, by its IANA name: what canonicalZone accepts,
// UTC included (some browsers leave it off this list).
const LISTED = Intl.supportedValuesOf('timeZone');
const ZONES = LISTED.includes('UTC') ? LISTED : [...LISTED, 'UTC'];

// Each zone's generic name ("Mountain Standard Time", "Alaska Time"), so a
// search for a clock as people say it finds the zone. Worked out once, the
// first time the list is searched or shown, and as of today: a zone's name
// follows its history (Juneau's was Pacific Time in 1970).
const NAMED_AT = Date.now();
let names: Map<string, string> | undefined;
function zoneName(zone: string): string {
  names ??= new Map(
    ZONES.map((z) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: z,
        timeZoneName: 'longGeneric',
      }).formatToParts(NAMED_AT);
      return [z, parts.find((p) => p.type === 'timeZoneName')?.value ?? ''];
    }),
  );
  return names.get(zone) ?? '';
}

// A booking's own clock (clockZone), for when its times are stated on another
// clock than its place's. Empty means the place's clock, which is nearly every
// booking. Shared by the activity's and the stay's When fields, so the wizard
// and the flat forms offer the same choice.
export function ClockZoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  // A stored zone this browser lists under another name stays selectable.
  const options = value && !ZONES.includes(value) ? [value, ...ZONES] : ZONES;
  return (
    <Autocomplete
      options={options}
      value={value || null}
      onChange={(_, zone) => onChange(zone ?? '')}
      getOptionLabel={zoneLabel}
      filterOptions={(zones, { inputValue }) => {
        const query = inputValue.trim().toLowerCase();
        if (!query) return zones;
        return zones.filter(
          (z) =>
            zoneLabel(z).toLowerCase().includes(query) || zoneName(z).toLowerCase().includes(query),
        );
      }}
      renderOption={({ key, ...props }, zone) => (
        <li key={key} {...props}>
          <Stack>
            <Typography variant="body2">{zoneLabel(zone)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {zoneName(zone)}
            </Typography>
          </Stack>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={
            <LabelWithTip
              text="Booking's clock (optional)"
              tip="Only when the booking states its times on another clock than the place's, like a tour sold on Arizona time (America/Phoenix) at a canyon on Navajo time. Leave it empty to use the place's clock."
            />
          }
          placeholder="The place's clock"
        />
      )}
    />
  );
}
