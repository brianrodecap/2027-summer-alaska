import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { type ClockChange, clockChangeText } from '../../model/dayClocks';
import { renderMaterialIcon } from '../shared/materialIcon';

// Between two rows of a day where the clock moves (a zone line, or a
// daylight-saving change): "Clocks go back 1 hour · MDT → MST", so the times
// either side of it are read on the right clock.
export function ClockChangeMarker({ change }: { change: ClockChange }) {
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        px: 1,
        color: 'tertiary.main',
        '& .MuiSvgIcon-root': { fontSize: 18 },
      }}
    >
      {renderMaterialIcon('schedule')}
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {clockChangeText(change)}
      </Typography>
    </Box>
  );
}
