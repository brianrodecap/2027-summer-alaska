import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { bookingCost } from '../../model/bookings';
import { formatMoney } from '../../model/tripModel';
import type { BudgetRow, BudgetTotals, Money } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';
import { BUDGET_BUCKET_ICON, BUDGET_BUCKET_LABEL } from './budgetLabels';
import { BudgetStats } from './BudgetStats';

// A row whose lines sit in different buckets (a room paid now, its fees
// due at the property) says how much is in each, rather than one label.
function bucketSummary(row: BudgetRow): string {
  // Summed per currency too, so a fee in another currency isn't read as dollars.
  const sums = new Map<string, { bucket: BudgetRow['bucket']; money: Money }>();
  for (const { bucket, amount } of row.lines) {
    const key = `${bucket}/${amount.currency}`;
    const sum = sums.get(key) ?? { bucket, money: { amount: 0, currency: amount.currency } };
    sum.money.amount += amount.amount;
    sums.set(key, sum);
  }
  if (new Set([...sums.values()].map((s) => s.bucket)).size < 2) {
    return BUDGET_BUCKET_LABEL[row.bucket];
  }
  return [...sums.values()]
    .map(({ bucket, money }) => `${BUDGET_BUCKET_LABEL[bucket]} ${formatMoney(money)}`)
    .join(' · ');
}

function BudgetRowItem({ row }: { row: BudgetRow }) {
  const amount =
    row.bucket === 'unplanned' ? 'Not yet costed' : formatMoney(bookingCost(row.booking));
  return (
    <ListItem
      secondaryAction={
        <Typography variant="body2" color="text.secondary">
          {amount}
        </Typography>
      }
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        {renderMaterialIcon(BUDGET_BUCKET_ICON[row.bucket], { fontSize: 'small' })}
      </ListItemIcon>
      <ListItemText primary={row.label} secondary={bucketSummary(row)} />
    </ListItem>
  );
}

export function BudgetGroup({
  headline,
  meta,
  totals,
  rows,
}: {
  headline: ReactNode;
  meta?: ReactNode;
  totals: BudgetTotals;
  rows: BudgetRow[];
}) {
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
