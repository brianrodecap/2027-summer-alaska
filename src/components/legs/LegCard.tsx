import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Typography from '@mui/material/Typography';

import { firstImage } from '../../model/formatting';
import { formatDateRangeLabel, tripDayCount } from '../../model/tripModel';
import type { LegSummary } from '../../model/types';
import { BookingChip } from '../shared/BookingChip';
import { BookingProgressBar } from '../shared/BookingProgressBar';

export function LegCard({
  summary,
  onOpen,
}: {
  summary: LegSummary;
  onOpen: (legId: string) => void;
}) {
  const { leg, dateRange, bookingProgress, bookingPercent } = summary;
  const range = dateRange ? formatDateRangeLabel(dateRange) : '';
  const dayCount = dateRange ? tripDayCount(dateRange) : 0;
  const image = firstImage(leg);

  return (
    <Card elevation={1} sx={{ borderRadius: 3 }}>
      <CardActionArea onClick={() => onOpen(leg._id)}>
        {image && (
          <Box sx={{ position: 'relative', height: 140 }}>
            <CardMedia
              component="img"
              image={image.uri}
              alt={image.caption ?? ''}
              title={image.credit ?? ''}
              loading="lazy"
              sx={{ height: 140 }}
            />
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
              <BookingProgressBar percent={bookingPercent} progress={bookingProgress} width={48} />
            </Box>
          </Box>
        )}
        <CardContent>
          <Typography variant="caption" color="text.secondary">
            {range} · {dayCount} days
          </Typography>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {leg.name}
          </Typography>
          {leg.booking ? (
            <BookingChip booking={leg.booking} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Booked piece by piece — no single reservation.
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
