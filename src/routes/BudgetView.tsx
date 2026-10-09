import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { BudgetBreakdowns } from '../components/budget/BudgetBreakdowns';
import { formatCostedTotal } from '../components/budget/budgetLabels';
import { BudgetStats } from '../components/budget/BudgetStats';
import type { BudgetView as BudgetViewModel } from '../model/types';
import { useTripData } from '../state/useTripData';

// What the costed total is made of: the part that grows with each traveler
// (with what that comes to per person, for "what if one more came along?")
// and the part that stays the same for any party size (rooms, fees).
function CostBasis({
  byBasis,
  travelerCount,
}: {
  byBasis: BudgetViewModel['byBasis'];
  travelerCount: number;
}) {
  const perTraveler = formatCostedTotal(byBasis.perTraveler);
  const fixed = formatCostedTotal(byBasis.fixed);
  if (!perTraveler && !fixed) return null;
  const { perTraveler: t } = byBasis;
  const each =
    perTraveler && travelerCount
      ? formatCostedTotal({
          ...t,
          spent: t.spent / travelerCount,
          pending: t.pending / travelerCount,
          estimated: t.estimated / travelerCount,
        })
      : null;
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
      {perTraveler && (
        <>
          Per traveler: <strong>{perTraveler}</strong>
          {each && ` (about ${each} each)`}
        </>
      )}
      {perTraveler && fixed && ' · '}
      {fixed && (
        <>
          Fixed: <strong>{fixed}</strong> for rooms, fees and other costs that don't change with
          party size
        </>
      )}
    </Typography>
  );
}

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
      <CostBasis byBasis={budget.byBasis} travelerCount={view.trip.travelers.length} />
      <Divider sx={{ my: 3 }} />
      <BudgetBreakdowns budget={budget} />
    </Box>
  );
}
