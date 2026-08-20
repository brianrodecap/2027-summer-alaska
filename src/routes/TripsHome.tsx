import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { formatTripDateChip, loadTripsIndex, tripDayCount } from '../model/tripModel';
import type { TripsIndexEntry } from '../model/types';

export function TripsHome() {
  const [trips, setTrips] = useState<TripsIndexEntry[] | null>(null);

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

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', p: 3 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>
        Trips
      </Typography>
      <List>
        {trips.map(({ slug, trip }) => (
          <ListItemButton key={slug} component={Link} to={`/${slug}`}>
            <ListItemText primary={trip.name} secondary={formatTripDateChip(trip, tripDayCount(trip))} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
