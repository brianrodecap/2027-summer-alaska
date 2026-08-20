import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

import { formatMoney } from '../../model/tripModel';
import { materialIcon } from '../shared/materialIcon';
import { BudgetStats } from './BudgetStats';
import { BUDGET_BUCKET_ICON, BUDGET_BUCKET_LABEL } from './budgetLabels';
import type { BudgetRow, BudgetTotals } from '../../model/types';

function BudgetRowItem({ row }: { row: BudgetRow }) {
  const Icon = materialIcon(BUDGET_BUCKET_ICON[row.bucket]);
  const amount = row.bucket === 'unplanned' ? 'Not yet costed' : formatMoney(row.booking.cost);
  return (
    <ListItem
      secondaryAction={
        <Typography variant="body2" color="text.secondary">
          {amount}
        </Typography>
      }
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Icon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={row.label} secondary={BUDGET_BUCKET_LABEL[row.bucket]} />
    </ListItem>
  );
}

export function BudgetGroup({ headline, meta, totals, rows }: { headline: ReactNode; meta?: ReactNode; totals: BudgetTotals; rows: BudgetRow[] }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1">{headline}</Typography>
      {meta && (
        <Typography variant="caption" color="text.secondary">
          {meta}
        </Typography>
      )}
      <Box sx={{ my: 1 }}>
        <BudgetStats totals={totals} variant="chips" />
      </Box>
      {rows.length > 0 && (
        <List dense disablePadding>
          {rows.map((row) => (
            <BudgetRowItem key={`${row.entity}-${row.id}`} row={row} />
          ))}
        </List>
      )}
    </Box>
  );
}
