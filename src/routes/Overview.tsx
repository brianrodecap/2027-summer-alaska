import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { useTripData } from '../state/TripDataContext';
import { LegCard } from '../components/legs/LegCard';
import { LegDialog } from '../components/legs/LegDialog';
import { BudgetStrip } from '../components/budget/BudgetStrip';

export function Overview() {
  const { view } = useTripData();
  const { slug } = useParams();
  const navigate = useNavigate();
  const [openLegId, setOpenLegId] = useState<string | null>(null);

  if (!view) return null;

  const openSummary = view.legSummaries.find((s) => s.leg._id === openLegId) ?? null;

  return (
    <Box sx={{ px: 3, pb: 4 }}>
      {view.trip.summary && (
        <Typography variant="body1" sx={{ mb: 3 }}>
          {view.trip.summary}
        </Typography>
      )}
      <Box sx={{ mb: 3 }}>
        <BudgetStrip totals={view.budget.totals} onClick={() => navigate(`/${slug}/budget`)} />
      </Box>
      <Grid container spacing={2}>
        {view.legSummaries.map((summary) => (
          <Grid key={summary.leg._id} size={{ xs: 12, sm: 6 }}>
            <LegCard summary={summary} onOpen={setOpenLegId} />
          </Grid>
        ))}
      </Grid>
      <LegDialog
        summary={openSummary}
        open={Boolean(openSummary)}
        onClose={() => setOpenLegId(null)}
        onSelectDay={(date) => navigate(`/${slug}/days/${date}`)}
      />
    </Box>
  );
}
