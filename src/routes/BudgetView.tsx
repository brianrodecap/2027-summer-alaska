import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { BudgetBreakdowns } from '../components/budget/BudgetBreakdowns';
import { BudgetStats } from '../components/budget/BudgetStats';
import { useTripData } from '../state/TripDataContext';

// The Budget page's own top section — the same big stat cards the Overview
// teaser links from, plus the one-time explainer of what each bucket means,
// followed by the By Leg/By Day/By Traveler breakdown tabs.
export function BudgetView() {
  const { view } = useTripData();
  if (!view) return null;
  const { budget } = view;

  return (
    <Box sx={{ px: 3, pb: 4 }}>
      <Typography variant="body1" sx={{ mb: 2 }}>
        Spent and pending are what's actually booked; estimated and unplanned are still just the
        plan.
        {budget.today && ` Pending balances are whatever's still due as of ${budget.today}.`}
      </Typography>
      <BudgetStats totals={budget.totals} variant="cards" />
      <Divider sx={{ my: 3 }} />
      <BudgetBreakdowns budget={budget} />
    </Box>
  );
}
