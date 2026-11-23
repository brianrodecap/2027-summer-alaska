import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useMemo } from 'react';

import { daySelectionRows, daySelectionState } from '../../model/daySelection';
import { selectionToMove, wholeDayMove } from '../../model/moveToDay';
import type { Day } from '../../model/types';
import { useMoveToDay } from '../../state/useMoveToDay';
import { useFilterSelection, useRowSelection } from '../../state/useTripSelections';
import { materialIcon } from '../shared/materialIcon';
import { useAnchorMenu } from '../shared/useAnchorMenu';

const MoreVertIcon = materialIcon('more_vert');
const EventIcon = materialIcon('event');
const SelectedIcon = materialIcon('check_box');
const UnselectedIcon = materialIcon('check_box_outline_blank');

const SCOPE = 'Activities, drives and plans, not stays';

// A day's action menu, the same “⋮” as a row's: move everything movable on the
// day to another day, or select it (to add to a selection, or pick other rows too).
// Sits inside the day accordion's summary, a <button>, so it is not one itself.
export function DayMenu({ day }: { day: Day }) {
  const { activeFilterTokens } = useFilterSelection();
  const { selection, selectRows, deselectRows } = useRowSelection();
  const { requestMove } = useMoveToDay();
  const { anchorEl, openAt, close, pick } = useAnchorMenu();
  const rows = useMemo(() => daySelectionRows(day, activeFilterTokens), [day, activeFilterTokens]);
  if (!rows.length) return null;

  const all = daySelectionState(rows, selection?.rows) === 'all';
  const ToggleIcon = all ? SelectedIcon : UnselectedIcon;
  return (
    <>
      <IconButton
        component="span"
        aria-label={`Actions for ${day.dateLabel}`}
        data-testid={`day-menu-${day.date}`}
        size="small"
        edge="end"
        sx={{ flexShrink: 0, alignSelf: 'center', ml: 0.5 }}
        onClick={openAt}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      {/* Menu items and the backdrop are React children of the summary, so a click
          in them must not reach it and expand or collapse the day. */}
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={close}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem
          onClick={pick(() =>
            // Whole only when no filter hides any of the day's rows.
            requestMove(
              daySelectionRows(day, new Set()).length === rows.length
                ? wholeDayMove(rows, day.date)
                : selectionToMove(rows),
            ),
          )}
        >
          <ListItemIcon>
            <EventIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText secondary={SCOPE}>Move this day…</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={pick(() =>
            all ? deselectRows(rows.map((row) => row.dragId)) : selectRows(rows),
          )}
        >
          <ListItemIcon>
            <ToggleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText secondary={SCOPE}>
            {all ? 'Deselect this day' : 'Select this day'}
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
