import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useMemo } from 'react';

import { daySelectionRows, daySelectionState } from '../../model/daySelection';
import type { Day } from '../../model/types';
import { useFilterSelection, useRowSelection } from '../../state/useTripSelections';
import { materialIcon } from '../shared/materialIcon';

const ICON = {
  none: materialIcon('check_box_outline_blank'),
  some: materialIcon('indeterminate_check_box'),
  all: materialIcon('check_box'),
};

// Selects (or deselects) everything on a day that can be moved, the same as
// clicking each row's handle: its activities, drives and plan groups. The selection
// bar then moves them together. Not a <button>: the accordion summary around it is
// one.
export function DaySelectButton({ day }: { day: Day }) {
  const { activeFilterTokens } = useFilterSelection();
  const { selection, selectRows, deselectRows } = useRowSelection();
  const rows = useMemo(() => daySelectionRows(day, activeFilterTokens), [day, activeFilterTokens]);
  if (!rows.length) return null;

  const state = daySelectionState(rows, selection?.rows);
  const all = state === 'all';
  const Icon = ICON[state];
  return (
    <Tooltip
      title={`${all ? 'Deselect' : 'Select'} this day’s activities, drives and plans (not stays)`}
    >
      <IconButton
        component="span"
        role="checkbox"
        aria-checked={state === 'some' ? 'mixed' : all}
        size="small"
        aria-label={`Select the items on ${day.dateLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          if (all) deselectRows(rows.map((row) => row.dragId));
          else selectRows(rows);
        }}
        sx={{ color: state === 'none' ? 'text.secondary' : 'primary.main', flexShrink: 0 }}
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
