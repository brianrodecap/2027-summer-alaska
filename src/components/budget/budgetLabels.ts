import { formatMoney } from '../../model/tripModel';
import type { BudgetBucket, BudgetTotals } from '../../model/types';

export const BUDGET_BUCKET_LABEL: Record<BudgetBucket, string> = {
  spent: 'Spent',
  pending: 'Pending',
  estimated: 'Estimated',
  unplanned: 'Unplanned',
};

export const BUDGET_BUCKET_ICON: Record<BudgetBucket, string> = {
  spent: 'paid',
  pending: 'schedule',
  estimated: 'request_quote',
  unplanned: 'help_outline',
};

export const BUDGET_BUCKETS: BudgetBucket[] = ['spent', 'pending', 'estimated', 'unplanned'];

// 'unplanned' has no dollar amount at all (that's the point of the bucket —
// see tripModel.ts's bookingBucket) so it renders as a count instead of a
// currency figure.
export function formatBudgetBucketAmount(
  totals: BudgetTotals,
  bucket: BudgetBucket,
): string | null {
  if (bucket === 'unplanned')
    return totals.unplannedCount ? `${totals.unplannedCount} not yet costed` : null;
  if (!totals[bucket]) return null;
  return formatMoney({ amount: totals[bucket], currency: totals.currency ?? 'USD' });
}
