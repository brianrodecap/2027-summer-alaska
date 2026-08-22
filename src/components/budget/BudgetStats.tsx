import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { BudgetTotals } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';
import {
  BUDGET_BUCKET_ICON,
  BUDGET_BUCKET_LABEL,
  BUDGET_BUCKETS,
  formatBudgetBucketAmount,
} from './budgetLabels';

// Shared by the Overview teaser and the Budget page's own summary — same
// four buckets, just laid out as compact chips or wider stat cards.
export function BudgetStats({
  totals,
  variant = 'chips',
}: {
  totals: BudgetTotals;
  variant?: 'chips' | 'cards';
}) {
  const entries = BUDGET_BUCKETS.map((bucket) => ({
    bucket,
    value: formatBudgetBucketAmount(totals, bucket),
  })).filter((e) => e.value);
  if (!entries.length) return null;

  if (variant === 'chips') {
    return (
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {entries.map(({ bucket, value }) => (
          <Chip
            key={bucket}
            icon={renderMaterialIcon(BUDGET_BUCKET_ICON[bucket], { fontSize: 'small' })}
            label={value}
            size="small"
          />
        ))}
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
      {entries.map(({ bucket, value }) => {
        return (
          <Stack
            key={bucket}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', minWidth: 160 }}
          >
            {renderMaterialIcon(BUDGET_BUCKET_ICON[bucket], { color: 'primary' })}
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
