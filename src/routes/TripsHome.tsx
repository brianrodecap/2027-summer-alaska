import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LandscapeIcon from '@mui/icons-material/Landscape';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { BookingProgressBar } from '../components/shared/BookingProgressBar';
import { TripEditDialog } from '../components/trips/TripEditDialog';
import type { StagedTripEntities } from '../model/documentImport';
import { exportNewTrip, exportTripEdit, exportTripRename } from '../model/exportEdits';
import { firstImage } from '../model/formatting';
import {
  formatTripDateChip,
  loadTripsIndex,
  tripBookingPercent,
  tripBookingProgress,
  tripDateRange,
  tripDayCount,
} from '../model/tripModel';
import type { Leg, Trip, TripsIndexEntry } from '../model/types';

type DialogState = { mode: 'add' } | { mode: 'edit'; slug: string };

export function TripsHome() {
  const [trips, setTrips] = useState<TripsIndexEntry[] | null>(null);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTripsIndex().then((entries) => {
      if (!cancelled) setTrips(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trips) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // There's no backend to save to, same as every other edit on this site —
  // the change shows up in this list immediately (in-memory only), while
  // exportNewTrip/exportTripEdit download whichever files it touched for
  // manual copy-back into the repo.
  const handleSaveTrip = (slug: string, trip: Trip, legs: Leg[], staged: StagedTripEntities) => {
    if (dialogState?.mode === 'edit') {
      const oldSlug = dialogState.slug;
      const updated = trips.map((t) =>
        t.slug === oldSlug ? { ...t, slug, trip, legs: [...t.legs, ...legs] } : t,
      );
      setTrips(updated);
      if (slug !== oldSlug) {
        exportTripRename(oldSlug, trip, updated.find((t) => t.slug === slug)!.legs, updated);
      } else {
        exportTripEdit(
          trip,
          legs.length > 0 ? updated.find((t) => t.slug === slug)!.legs : undefined,
        );
      }
    } else {
      const updated = [
        ...trips,
        {
          slug,
          trip,
          legs,
          stays: staged.stays,
          transits: staged.transits,
          activities: staged.activities,
        },
      ];
      setTrips(updated);
      exportNewTrip(trip, legs, staged, updated);
    }
    setDialogState(null);
  };

  const editing =
    dialogState?.mode === 'edit' ? trips.find((t) => t.slug === dialogState.slug) : undefined;

  // Trips with a computed range (from their own Stays/Transits/Activities)
  // sort chronologically; a trip with nothing dated yet has no range to sort
  // by, so it sorts last.
  const sortedTrips = [...trips].sort((a, b) => {
    const rangeA = tripDateRange(a.stays, a.transits, a.activities);
    const rangeB = tripDateRange(b.stays, b.transits, b.activities);
    if (!rangeA && !rangeB) return 0;
    if (!rangeA) return 1;
    if (!rangeB) return -1;
    return rangeA.startDate.localeCompare(rangeB.startDate);
  });

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4">Trips</Typography>
        <Button startIcon={<AddIcon />} onClick={() => setDialogState({ mode: 'add' })}>
          Add trip
        </Button>
      </Stack>
      <Grid container spacing={2}>
        {sortedTrips.map(({ slug, trip, legs, stays, transits, activities }) => {
          const image = firstImage(trip);
          const range = tripDateRange(stays, transits, activities);
          const progress = tripBookingProgress(legs, stays, transits, activities);
          const percent = tripBookingPercent(legs, stays, transits, activities);
          return (
            <Grid key={slug} size={{ xs: 12, sm: 6 }} sx={{ display: 'flex' }}>
              <Card
                elevation={1}
                sx={{
                  borderRadius: 3,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%',
                }}
              >
                <CardActionArea
                  component={Link}
                  to={`/${slug}`}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    justifyContent: 'flex-start',
                    height: '100%',
                  }}
                >
                  <Box sx={{ position: 'relative', height: 160, flexShrink: 0 }}>
                    {image ? (
                      <CardMedia
                        component="img"
                        image={image.uri}
                        alt={image.caption ?? ''}
                        title={image.credit ?? ''}
                        sx={{ height: 160 }}
                      />
                    ) : (
                      <Box
                        sx={{
                          height: 160,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: 'primary.container',
                          color: 'primary.onContainer',
                        }}
                      >
                        <LandscapeIcon sx={{ fontSize: 48 }} />
                      </Box>
                    )}
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 8,
                        right: 8,
                        display: 'flex',
                        alignItems: 'center',
                        bgcolor: 'background.paper',
                        borderRadius: 3,
                        px: 1,
                        py: 0.5,
                        boxShadow: 1,
                      }}
                    >
                      <BookingProgressBar percent={percent} progress={progress} width={48} />
                    </Box>
                  </Box>
                  <CardContent>
                    <Typography variant="h6">{trip.name}</Typography>
                    {range && (
                      <Typography variant="body2" color="text.secondary">
                        {formatTripDateChip(range, tripDayCount(range))}
                      </Typography>
                    )}
                  </CardContent>
                </CardActionArea>
                <IconButton
                  aria-label="Edit trip"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDialogState({ mode: 'edit', slug });
                  }}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' },
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Card>
            </Grid>
          );
        })}
      </Grid>
      {dialogState && (
        <TripEditDialog
          trip={editing?.trip}
          slug={editing?.slug}
          legs={editing?.legs}
          existingSlugs={trips.filter((t) => t.slug !== editing?.slug).map((t) => t.slug)}
          onClose={() => setDialogState(null)}
          onSave={handleSaveTrip}
        />
      )}
    </Box>
  );
}
