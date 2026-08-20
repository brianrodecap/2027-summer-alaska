import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardMedia from '@mui/material/CardMedia';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { firstImage } from '../../model/formatting';
import { BookingChip } from '../shared/BookingChip';
import type { LegSummary } from '../../model/types';

export function LegCard({ summary, onOpen }: { summary: LegSummary; onOpen: (legId: string) => void }) {
  const { leg, days } = summary;
  const range = days.length ? `${days[0].dateLabel} – ${days[days.length - 1].dateLabel}` : '';
  const image = firstImage(leg);

  return (
    <Card elevation={1} sx={{ borderRadius: 3 }}>
      <CardActionArea onClick={() => onOpen(leg._id)}>
        {image && (
          <CardMedia component="img" image={image.uri} alt={image.caption ?? ''} title={image.credit ?? ''} sx={{ height: 140 }} />
        )}
        <CardContent>
          <Typography variant="caption" color="text.secondary">
            {range} · {days.length} days
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
