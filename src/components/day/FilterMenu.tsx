import { useState } from 'react';
import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import FilterListIcon from '@mui/icons-material/FilterList';

import { buildFilterGroups } from '../../model/filters';
import { materialIcon } from '../shared/materialIcon';
import { useFilterSelection } from '../../state/TripSelectionsContext';
import type { LegSummary } from '../../model/types';

// The day list's own filter nav — an icon button opening a checklist menu
// grouped Booking / Attributes / Leg (docs/js/filters.js's own vocabulary).
// Each row toggles independently without closing the menu (MUI's Menu only
// closes on an explicit onClose, so picking several rows in one visit just
// works), matching the old app's "keep-open" menu items.
export function FilterMenu({ legSummaries }: { legSummaries: LegSummary[] }) {
  const { activeFilterTokens, toggleFilterToken, clearFilterTokens } = useFilterSelection();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const groups = buildFilterGroups(legSummaries);

  return (
    <>
      <IconButton aria-label="Filter days" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge badgeContent={activeFilterTokens.size} color="primary">
          <FilterListIcon />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {groups.flatMap((group, gi) => [
          gi > 0 && <Divider key={`div-${group.id}`} />,
          ...group.options.map((option) => {
            const Icon = materialIcon(option.icon);
            const checked = activeFilterTokens.has(option.token);
            return (
              <MenuItem key={option.token} onClick={() => toggleFilterToken(option.token)} dense>
                <Checkbox checked={checked} size="small" disableRipple sx={{ p: 0, mr: 1.5 }} />
                <Icon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
                <ListItemText primary={option.label} />
              </MenuItem>
            );
          }),
        ])}
        {activeFilterTokens.size > 0 && [
          <Divider key="clear-div" />,
          <MenuItem
            key="clear"
            onClick={() => {
              clearFilterTokens();
              setAnchorEl(null);
            }}
          >
            Clear filters
          </MenuItem>,
        ]}
      </Menu>
    </>
  );
}
