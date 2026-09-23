import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

import type { EnrichedTransit } from '../../model/types';
import { useRouteToneSelection } from '../../state/useTripSelections';
import { renderMaterialIcon, ROUTE_TONE_ICON } from '../shared/materialIcon';

// A Route with 2+ variants (e.g. the New vs. Old Glenn Highway) is a
// genuinely undecided choice, anchored to the Depart row — the one place in
// the timeline that's unambiguously "the start of this route." Every
// variant's stages were already walked in buildTripView, so switching here
// just changes which precomputed variant's stages/arrival the rest of the
// timeline shows. The row's transit is the live one (liveDays.ts's
// liveTransits), so its routeInfo.selectedTone is already the picked tab.
export function RouteVariantTabs({ transit }: { transit: EnrichedTransit }) {
  const info = transit.routeInfo;
  const { selectRouteTone } = useRouteToneSelection();
  if (!info || info.variants.length < 2) return null;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mt: 1, flexWrap: 'wrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {info.variants.map((v) => {
        const active = v.tone === info.selectedTone;
        return (
          <Chip
            key={v.tone}
            data-testid={`route-variant-${transit._id}-${v.tone}`}
            label={v.label}
            icon={renderMaterialIcon(ROUTE_TONE_ICON[v.tone] ?? 'route', { fontSize: 'small' })}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            onClick={() => selectRouteTone(transit._id, v.tone)}
          />
        );
      })}
    </Stack>
  );
}
