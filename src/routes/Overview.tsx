import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { BudgetStrip } from '../components/budget/BudgetStrip';
import { AddLegDialog } from '../components/legs/AddLegDialog';
import { LegCard } from '../components/legs/LegCard';
import { LegDialog } from '../components/legs/LegDialog';
import type { Leg } from '../model/types';
import { useTripData } from '../state/useTripData';

export function Overview() {
  const { view, data, setData } = useTripData();
  const { slug } = useParams();
  const navigate = useNavigate();
  const [openLegId, setOpenLegId] = useState<string | null>(null);
  const [addingLeg, setAddingLeg] = useState(false);

  if (!view || !data) return null;

  if (view.legSummaries.length === 1) {
    return <Navigate to={`/${slug}/days`} replace />;
  }

  const openSummary = view.legSummaries.find((s) => s.leg._id === openLegId) ?? null;

  const handleCreateLeg = (leg: Leg) => {
    setData((prev) => ({ ...prev, legs: [...prev.legs, leg] }), ['legs']);
    setAddingLeg(false);
  };

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
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Legs</Typography>
        <Button startIcon={<AddIcon />} onClick={() => setAddingLeg(true)}>
          Add leg
        </Button>
      </Stack>
      {view.legSummaries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Nothing planned yet — add a leg to give this trip a date range before adding Stays,
          Transits, or Activities to it.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {view.legSummaries.map((summary) => (
            <Grid key={summary.leg._id} size={{ xs: 12, sm: 6 }}>
              <LegCard summary={summary} onOpen={setOpenLegId} />
            </Grid>
          ))}
        </Grid>
      )}
      <LegDialog
        summary={openSummary}
        open={Boolean(openSummary)}
        onClose={() => setOpenLegId(null)}
        onSelectDay={(date) => navigate(`/${slug}/days/${date}`)}
      />
      {addingLeg && (
        <AddLegDialog
          tripId={view.trip._id}
          onClose={() => setAddingLeg(false)}
          onCreate={handleCreateLeg}
        />
      )}
    </Box>
  );
}
