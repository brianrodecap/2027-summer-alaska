import Box from '@mui/material/Box';

import { WORDMARK_SRC } from '../../config/brand';

// The Trippin' wordmark as shown in page headers (trips list, trip hero).
export function Wordmark() {
  return (
    <Box
      component="img"
      src={WORDMARK_SRC}
      alt="Trippin'"
      sx={{ height: { xs: 40, sm: 56 }, flexShrink: 0 }}
    />
  );
}
