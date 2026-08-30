import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Suspense } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';

import { exportEdits } from '../model/exportEdits';
import { formatTripDateChip, tripDayCount } from '../model/tripModel';
import { EditProvider } from '../state/EditContext';
import { NoteEditProvider } from '../state/NoteEditContext';
import { TripDataProvider } from '../state/TripDataContext';
import { TripSelectionsProvider } from '../state/TripSelectionsContext';
import { useTripData } from '../state/useTripData';

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
  const heroImage = trip.images[0];
  const heroIconSx = heroImage ? { color: 'inherit' } : undefined;
  const heroChipSx = heroImage
    ? { color: 'inherit', borderColor: 'rgba(255,255,255,0.7)' }
    : undefined;
  const heroChipVariant = heroImage ? 'outlined' : 'filled';

  return (
    <Box
      component="header"
      title={heroImage?.credit ?? undefined}
      sx={{
        position: 'relative',
        px: 3,
        pt: 3,
        pb: 2,
        overflow: 'hidden',
        ...(heroImage
          ? {
              color: '#fff',
              backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.68)), url("${heroImage.uri}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : { bgcolor: 'primary.container', color: 'primary.onContainer' }),
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <IconButton aria-label="Back to trips" onClick={() => navigate('/')} sx={heroIconSx}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          {trip.name}
        </Typography>
        {dirtyCollections.size > 0 && (
          <IconButton
            aria-label="Export edits"
            onClick={() => exportEdits(data, dirtyCollections)}
            sx={heroIconSx}
          >
            <DownloadIcon />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ ml: 6, flexWrap: 'wrap', rowGap: 1 }}>
        {view.dateRange && (
          <Chip
            label={formatTripDateChip(view.dateRange, tripDayCount(view.dateRange))}
            component={Link}
            to={`/${slug}/days`}
            clickable
            sx={heroChipSx}
            variant={heroChipVariant}
          />
        )}
        <Chip
          label="Budget"
          component={Link}
          to={`/${slug}/budget`}
          clickable
          sx={heroChipSx}
          variant={heroChipVariant}
        />
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
          <NoteEditProvider>
            <TripHero />
            <Suspense
              fallback={
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress />
                </Box>
              }
            >
              <Outlet />
            </Suspense>
          </NoteEditProvider>
        </EditProvider>
      </TripSelectionsProvider>
    </TripDataProvider>
  );
}
