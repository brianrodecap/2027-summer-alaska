import DownloadIcon from '@mui/icons-material/Download';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import { ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Suspense, useEffect } from 'react';
import { Link, Outlet, useMatch, useParams } from 'react-router-dom';

import { Wordmark } from '../components/shared/Wordmark';
import { exportEdits } from '../model/exportEdits';
import { formatTripDateChip, tripDayCount } from '../model/tripModel';
import { EditProvider } from '../state/EditContext';
import { NoteEditProvider } from '../state/NoteEditContext';
import { TripDataProvider } from '../state/TripDataContext';
import { TripSelectionsProvider } from '../state/TripSelectionsContext';
import { useTripData } from '../state/useTripData';
import { THEMES } from '../theme';

function TripHero() {
  const { slug } = useParams();
  const section = useMatch('/:slug/:section/*')?.params.section;
  const { view, data, loading, error, dirtyCollections } = useTripData();
  const tripName = view?.trip.name;

  useEffect(() => {
    if (!tripName) return;
    const defaultTitle = document.title;
    document.title = `${defaultTitle} · ${tripName}`;
    return () => {
      document.title = defaultTitle;
    };
  }, [tripName]);

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
  const sectionLabel = section === 'days' ? 'Days' : section === 'budget' ? 'Budget' : null;
  const heroImage = trip.images[0];
  // The photo hero is a dark surface in both color modes, so it renders under the
  // dark theme: its icons, chips and h4 gold then resolve to dark-mode values
  // without any per-element overrides. Only the outlined chips' border needs a
  // brighter line to read against the photo.
  const heroChipSx = heroImage ? { borderColor: 'rgba(255,255,255,0.7)' } : undefined;
  const heroChipVariant = heroImage ? 'outlined' : 'filled';

  const header = (
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
              color: 'common.white',
              backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.68)), url("${heroImage.uri}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : { bgcolor: 'primary.container', color: 'primary.onContainer' }),
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Breadcrumbs
          aria-label="Breadcrumb"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            color: 'inherit',
            '& .MuiBreadcrumbs-separator': { color: 'inherit' },
          }}
        >
          <MuiLink component={Link} to="/" color="inherit" underline="hover">
            Trips
          </MuiLink>
          {sectionLabel ? (
            [
              <MuiLink
                key="trip"
                component={Link}
                to={`/${slug}`}
                color="inherit"
                underline="hover"
              >
                {trip.name}
              </MuiLink>,
              <Typography key="section" color="inherit" aria-current="page">
                {sectionLabel}
              </Typography>,
            ]
          ) : (
            <Typography color="inherit" aria-current="page">
              {trip.name}
            </Typography>
          )}
        </Breadcrumbs>
        {dirtyCollections.size > 0 && (
          <IconButton aria-label="Export edits" onClick={() => exportEdits(data, dirtyCollections)}>
            <DownloadIcon />
          </IconButton>
        )}
        <Wordmark />
      </Stack>
      <Typography variant="h4" sx={{ mb: 1.5 }}>
        {trip.name}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
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

  return heroImage ? <ThemeProvider theme={THEMES.dark}>{header}</ThemeProvider> : header;
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
