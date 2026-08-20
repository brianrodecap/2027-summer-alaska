import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';

import { TripDataProvider, useTripData } from '../state/TripDataContext';
import { TripSelectionsProvider } from '../state/TripSelectionsContext';
import { EditProvider } from '../state/EditContext';
import { formatTripDateChip, tripDayCount } from '../model/tripModel';
import { exportEdits } from '../model/exportEdits';

function TripHero() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const { view, data, loading, error, dirtyCollections } = useTripData();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !view || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error?.message ?? 'Failed to load trip.'}</Alert>
      </Box>
    );
  }

  const { trip } = view;

  return (
    <Box component="header" sx={{ px: 3, pt: 3, pb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <IconButton aria-label="Back to trips" onClick={() => navigate('/')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          {trip.name}
        </Typography>
        {dirtyCollections.size > 0 && (
          <IconButton aria-label="Export edits" onClick={() => exportEdits(data, dirtyCollections)}>
            <DownloadIcon />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ ml: 6 }}>
        <Chip label={formatTripDateChip(trip, tripDayCount(trip))} component={Link} to={`/${slug}/days`} clickable />
        <Chip label="Budget" component={Link} to={`/${slug}/budget`} clickable />
      </Stack>
    </Box>
  );
}

export function TripLayout() {
  const { slug } = useParams();
  if (!slug) return null;
  return (
    <TripDataProvider slug={slug}>
      <TripSelectionsProvider>
        <EditProvider>
          <TripHero />
          <Outlet />
        </EditProvider>
      </TripSelectionsProvider>
    </TripDataProvider>
  );
}
