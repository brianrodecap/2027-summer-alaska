import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { materialIcon } from '../shared/materialIcon';
import { BUDGET_BUCKETS, BUDGET_BUCKET_ICON, BUDGET_BUCKET_LABEL, formatBudgetBucketAmount } from './budgetLabels';
import type { BudgetTotals } from '../../model/types';

// Shared by the Overview teaser and the Budget page's own summary — same
// four buckets, just laid out as compact chips or wider stat cards.
export function BudgetStats({ totals, variant = 'chips' }: { totals: BudgetTotals; variant?: 'chips' | 'cards' }) {
  const entries = BUDGET_BUCKETS.map((bucket) => ({ bucket, value: formatBudgetBucketAmount(totals, bucket) })).filter((e) => e.value);
  if (!entries.length) return null;

  if (variant === 'chips') {
    return (
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {entries.map(({ bucket, value }) => {
          const Icon = materialIcon(BUDGET_BUCKET_ICON[bucket]);
          return <Chip key={bucket} icon={<Icon fontSize="small" />} label={value} size="small" />;
        })}
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
      {entries.map(({ bucket, value }) => {
        const Icon = materialIcon(BUDGET_BUCKET_ICON[bucket]);
        return (
          <Stack key={bucket} direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 160 }}>
            <Icon color="primary" />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {BUDGET_BUCKET_LABEL[bucket]}
              </Typography>
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
