import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import GroupIcon from '@mui/icons-material/Group';
import RouteIcon from '@mui/icons-material/Route';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { BudgetView } from '../../model/types';
import { BudgetGroup } from './BudgetGroup';

function ByLegPanel({ byLeg }: { byLeg: BudgetView['byLeg'] }) {
  if (!byLeg.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing booked or estimated yet.
      </Typography>
    );
  }
  return (
    <>
      {byLeg.map((g) => (
        <BudgetGroup key={g.leg._id} headline={g.leg.name} totals={g.totals} rows={g.rows} />
      ))}
    </>
  );
}

function ByDayPanel({ byDay }: { byDay: BudgetView['byDay'] }) {
  if (!byDay.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing dated has a cost yet.
      </Typography>
    );
  }
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Leg-level bundles (like the cruise fare) aren't tied to one day — see the By Leg tab.
      </Typography>
      {byDay.map((g) => (
        <BudgetGroup
          key={g.day.date}
          headline={g.day.dateLabel}
          meta={g.day.title}
          totals={g.totals}
          rows={g.rows}
        />
      ))}
    </>
  );
}

function ByTravelerPanel({ byTraveler }: { byTraveler: BudgetView['byTraveler'] }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        A cost with no per-passenger fare split is divided evenly across every traveler — an
        inferred share, not an authored one.
      </Typography>
      {byTraveler.map((g) => (
        <BudgetGroup key={g.name} headline={g.name} totals={g.totals} rows={[]} />
      ))}
    </>
  );
}

// The Budget page's By Leg/By Day/By Traveler tabs.
export function BudgetBreakdowns({ budget }: { budget: BudgetView }) {
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<RouteIcon fontSize="small" />} iconPosition="start" label="By Leg" />
        <Tab icon={<CalendarMonthIcon fontSize="small" />} iconPosition="start" label="By Day" />
        <Tab icon={<GroupIcon fontSize="small" />} iconPosition="start" label="By Traveler" />
      </Tabs>
      {tab === 0 && <ByLegPanel byLeg={budget.byLeg} />}
      {tab === 1 && <ByDayPanel byDay={budget.byDay} />}
      {tab === 2 && <ByTravelerPanel byTraveler={budget.byTraveler} />}
    </Box>
  );
}
