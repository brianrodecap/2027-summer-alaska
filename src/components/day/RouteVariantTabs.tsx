import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';

import { variantColor } from '../../model/routePlanner';
import type { EnrichedTransit } from '../../model/types';
import { useRouteVariantSelection } from '../../state/useTripSelections';

// A Route with 2+ variants (e.g. the New vs. Old Glenn Highway) is a
// genuinely undecided choice, anchored to the Depart row — the one place in
// the timeline that's unambiguously "the start of this route." Every
// variant's stages were already walked in buildTripView, so switching here
// just changes which precomputed variant's stages/arrival the rest of the
// timeline shows. The row's transit is the live one (liveDays.ts's
// liveTransits), so its routeInfo.selectedId is already the picked tab.
export function RouteVariantTabs({ transit }: { transit: EnrichedTransit }) {
  const info = transit.routeInfo;
  const { selectRouteVariant } = useRouteVariantSelection();
  const { palette } = useTheme();
  if (!info || info.variants.length < 2) return null;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mt: 1, flexWrap: 'wrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {info.variants.map((v, i) => {
        const active = v.id === info.selectedId;
        return (
          <Chip
            key={v.id}
            data-testid={`route-variant-${transit._id}-${v.id}`}
            label={v.label}
            icon={
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: variantColor(palette.routeVariants, info.variants, i),
                }}
              />
            }
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            onClick={() => selectRouteVariant(transit._id, v.id)}
          />
        );
      })}
    </Stack>
  );
}
