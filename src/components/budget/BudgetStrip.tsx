import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';

import { BudgetStats } from './BudgetStats';
import type { BudgetTotals } from '../../model/types';

// The Overview section's always-visible teaser — clicking it navigates to
// the dedicated Budget page.
export function BudgetStrip({ totals, onClick }: { totals: BudgetTotals; onClick: () => void }) {
  return (
    <ButtonBase onClick={onClick} sx={{ width: '100%', textAlign: 'left', borderRadius: 3 }} aria-label="View full budget">
      <Paper variant="outlined" sx={{ width: '100%', p: 2, borderRadius: 3 }}>
        <BudgetStats totals={totals} variant="cards" />
      </Paper>
    </ButtonBase>
  );
}
