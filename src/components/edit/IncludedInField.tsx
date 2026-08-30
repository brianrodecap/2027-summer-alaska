import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMemo, useRef } from 'react';

import { includedInOptions, includedInValue, parseIncludedIn } from '../../model/editForms';
import { formatDateLabel } from '../../model/tripModel';
import type { Activity, DiningFormat, Ref, Stay, Transit } from '../../model/types';

// The candidate list can span the whole trip and reuse names across days
// (two different "Free time" activities, say), so options are grouped under
// a date header and, when the menu opens, scrolled to jumpToDate's group —
// normally the activity's own date — instead of making the user hunt
// through the whole list.
export function IncludedInField({
  diningFormat,
  stays,
  activities,
  transits,
  value,
  onChange,
  jumpToDate,
}: {
  diningFormat: DiningFormat | '';
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  value: Ref | null;
  onChange: (value: Ref | null) => void;
  jumpToDate: string | null;
}) {
  const options = useMemo(
    () => includedInOptions(diningFormat, stays, activities, transits),
    [diningFormat, stays, activities, transits],
  );
  const groupRefs = useRef(new Map<string, HTMLLIElement>());

  const handleOpen = () => {
    if (!jumpToDate) return;
    requestAnimationFrame(() => {
      const dates = [...groupRefs.current.keys()].sort();
      const target = dates.find((d) => d >= jumpToDate) ?? dates.at(-1);
      if (target) groupRefs.current.get(target)?.scrollIntoView({ block: 'start' });
    });
  };

  const items: React.ReactNode[] = [];
  let lastDate: string | null = null;
  for (const o of options) {
    if (o.date !== lastDate) {
      lastDate = o.date;
      items.push(
        <ListSubheader
          key={`header-${o.date}`}
          ref={(el: HTMLLIElement | null) => {
            if (el) groupRefs.current.set(o.date, el);
          }}
        >
          {formatDateLabel(o.date)}
        </ListSubheader>,
      );
    }
    items.push(
      <MenuItem key={o.value} value={o.value}>
        {o.label}
      </MenuItem>,
    );
  }

  return (
    <TextField
      select
      label="Included in"
      value={includedInValue(value)}
      onChange={(e) => onChange(parseIncludedIn(e.target.value))}
      slotProps={{ select: { onOpen: handleOpen } }}
    >
      <MenuItem value="">Not included/covered</MenuItem>
      {items}
    </TextField>
  );
}
